// Import necessary modules
import express, { Request, Response, Application } from 'express';
import dotenv from 'dotenv';
import asyncHandler from 'express-async-handler';
import { z } from 'zod'; // For tool schemas
import { generateText, tool, CoreTool, generateObject, Output } from 'ai'; // Core Vercel AI SDK components
import { anthropic } from '@ai-sdk/anthropic'; // Import Anthropic provider

// Import tool functions
import { searchApiDocumentation } from './tools/searchApiDocumentation';
import { readWebpageContent } from './tools/readWebpageContent';
import { validateOpenAPISchema } from './tools/validateOpenAPISchema';
import { evaluateAlignment } from './tools/evaluateAlignment';
import { evaluateVeracity } from './tools/evaluateVeracity';

// Load environment variables from .env file
dotenv.config();

// Initialize the Express application
const app = express();

// Define the port the server will listen on
// Use the PORT environment variable if available, otherwise default to 3000
const PORT = process.env.PORT || 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// --- Define Tools for the Main Agent ---
const agentTools: Record<string, CoreTool> = {
    search_api_documentation: tool({
        description: 'Search Google for relevant API documentation URLs based on a user query.',
        parameters: z.object({
            query: z.string().describe('The user query to search documentation for'),
        }),
        execute: async ({ query }) => searchApiDocumentation(query),
    }),
    read_webpage_content: tool({
        description: 'Read the text content of a webpage given its URL. Returns HTML if Markdown fails.',
        parameters: z.object({
            url: z.string(),
        }),
        execute: async ({ url }) => readWebpageContent(url),
    }),
    validate_openapi_schema: tool({
        description: 'Validate if a given string is a syntactically correct OpenAPI Specification (JSON format expected).',
        parameters: z.object({
            oas_json_string: z.string().describe('The potential OpenAPI specification as a JSON string'),
        }),
        execute: async ({ oas_json_string }) => validateOpenAPISchema(oas_json_string),
    }),
    evaluate_alignment: tool({
        description: 'Evaluate how well a generated OAS aligns with the original user query (score 0.0-5.0).',
        parameters: z.object({
            user_query: z.string().describe('The original user query'),
            generated_oas: z.union([z.string(), z.object({})]).describe('The generated OAS (JSON string or object)'),
        }),
        execute: async ({ user_query, generated_oas }) => evaluateAlignment(user_query, generated_oas),
    }),
    evaluate_veracity: tool({
        description: 'Evaluate if a generated OAS accurately reflects current online documentation at a source URL.',
        parameters: z.object({
            generated_oas: z.union([z.string(), z.object({})]).describe('The generated OAS (JSON string or object)'),
            source_url: z.union([z.string(), z.array(z.string())]),
        }),
        execute: async ({ generated_oas, source_url }) => evaluateVeracity(generated_oas, source_url),
    }),
};

/**
 * POST /api/generate-openapi (Modified Workflow)
 */
app.post('/api/generate-openapi', asyncHandler(async (req: Request, res: Response) => {
  const { query }: { query?: string } = req.body;

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: "Missing or invalid 'query' in request body" });
    return;
  }
  console.log(`Received query: ${query}`);

  try {
    // --- Step 1: Intent Check (using Claude Sonnet & generateObject) ---
    console.log('Performing intent check with Claude Sonnet...');
    const intentCheckPrompt = `Does the following request ask for an OpenAPI specification or API definition?\n\nRequest: \"${query}\"`;
    const intentSchema = z.object({
        intent: z.enum(['yes', 'no']).describe("Whether the request is for an OAS ('yes' or 'no')") 
    });
    const intentResult = await generateObject({
      model: anthropic('claude-3-7-sonnet-latest'), // Switched to Sonnet for potentially better structuring
      prompt: intentCheckPrompt,
      schema: intentSchema,
    });
    console.log('Intent check constrained response:', intentResult.object); 
    if (intentResult.object.intent !== 'yes') { 
      console.log('Intent check determined request is not for OAS. Returning empty response.');
      // Return empty for non-OAS requests, maybe change this later?
      res.status(200).json({}); 
      return;
    }
    console.log('Intent check passed.');

    // --- Step 2: Decompose Request into Operations (NEW) ---
    console.log('Decomposing request into operations...');
    const decompositionPrompt = `Based on the user query, identify the distinct, self-contained API operations or endpoints requested. Output ONLY a JSON object with a single key "operations" which is an array of strings. Each string should describe one specific operation clearly as well as the API provider (e.g., "Create a Stripe refund", "Retrieve a specific Stripe refund by ID", "List all Stripe refunds").\n\nUser Query: "${query}"`;
    const decompositionSchema = z.object({ 
        operations: z.array(z.string()).describe("List of distinct API operations requested") 
    });
    const decompositionResult = await generateObject({ 
      model: anthropic('claude-3-7-sonnet-latest'), // Switched to Sonnet for potentially better structuring
      prompt: decompositionPrompt, 
      schema: decompositionSchema 
    });
    const requestedOperations = decompositionResult.object.operations;
    
    if (!requestedOperations || requestedOperations.length === 0) {
        console.log("Could not decompose request into specific operations.");
        res.status(400).json({ error: "Could not understand the specific API operations requested in the query."});
        return;
    }
    console.log("Decomposed Operations:", requestedOperations);

    // --- Step 3: Process Only the First Operation ---
    // Select only the first operation identified
    const operation = requestedOperations[0];
    let generatedOASString: string | null = null; // Store the successful OAS string
    let processingError: { operation: string; error: string } | null = null; // Store potential error

    // Define the expected schema for the OAS fragment - Used in Step 3b
    // More detailed schema to provide better guidance
    const oasFragmentSchema = z.object({
        openapi: z.string().optional().describe("OpenAPI version string, e.g., '3.0.0' or '3.1.0'"),
        info: z.object({
            title: z.string().optional().describe("Title for this API fragment"),
            version: z.string().optional().describe("Version string for this API fragment"),
        }).passthrough().optional().describe("Basic information about the API fragment"),
        paths: z.record( // Allows any string as path key (e.g., /v1/refunds)
            z.record( // Allows any string as method key (e.g., 'post')
                z.object({
                    summary: z.string().optional(),
                    description: z.string().optional(),
                    operationId: z.string().optional(),
                    parameters: z.array(z.object({}).passthrough()).optional().describe("Array of parameter objects (path, query, header, cookie)"),
                    requestBody: z.object({}).passthrough().optional().describe("Request body definition (content, required)"),
                    responses: z.record( // Allows any status code string as key (e.g., '200')
                         z.object({}).passthrough() // Allows any valid response object structure
                    ).optional().describe("Responses object mapping status codes to response definitions") ,
                    security: z.array(z.record(z.array(z.string()))).optional().describe("Security requirements array")
                }).passthrough() // Allow other standard operation fields (tags, etc.)
            )
        ).optional().describe("API paths and operations. Should contain one path and one method for the target operation."),
        components: z.object({
            schemas: z.record(z.object({}).passthrough()).optional().describe("Reusable schema definitions used in requestBody or responses"),
            securitySchemes: z.record(z.object({}).passthrough()).optional().describe("Security scheme definitions (e.g., bearerAuth)")
        }).passthrough().optional().describe("Reusable components like schemas and security schemes")
    }).passthrough() // Allow other top-level OAS fields if needed
    .describe("A valid OpenAPI 3.x JSON object fragment describing a single API operation, constructed from the provided text summary.");

    // --- Step 3a: Information Gathering using generateText with Tools ---
    console.log(`\n--- Starting Step 3a: Information Gathering for operation: ${operation} ---`);
    let gatheredInformation: string | null = null;
    try {
        // System Prompt for Information Gathering (Even Stricter)
        const infoGatheringSystemPrompt = `
Objective: Gather comprehensive information needed to create an OpenAPI Specification (OAS 3.x) fragment for the specific API operation: '{operation}'.

Process:
1.  Understand the operation: '{operation}'.
2.  Use available tools ('search_api_documentation', 'read_webpage_content') to find and read relevant documentation SPECIFICALLY for this operation. Focus ONLY on '{operation}'.
3.  Extract key factual details from the tool results: HTTP method, full path, parameters (path, query, header, request body with types/descriptions), successful response schemas (e.g., 200 OK structure), and security requirements.
4.  **CRITICAL OUTPUT REQUIREMENT:** Your final output MUST be ONLY the consolidated, factual text summary of the details extracted from the tool results. Do NOT include introductions, conclusions, explanations, apologies, or any conversational text (like "Okay, I found..." or "Let me check..."). Output ONLY the extracted facts. Example: "Operation: Create Refund. Method: POST. Path: /v1/refunds. Body params: amount (integer), charge (string),... Response(200): refund object with id, amount,...".
`;
        const currentInfoSystemPrompt = infoGatheringSystemPrompt.replace(/{operation}/g, operation);

        const infoAgentResult = await generateText({
            model: anthropic('claude-3-7-sonnet-latest'),
            
            system: currentInfoSystemPrompt,
            prompt: `Gather all necessary details for the operation: "${operation}" using the available tools. Output the summarized information as plain text.`, 
            // No mode, no experimental_output here
            tools: agentTools,
            maxSteps: 5, 
        });

        // --- START: Log the entire infoAgentResult (Re-added for debugging) --- 
        console.log("--- Full infoAgentResult from Step 3a: ---");
        console.log(JSON.stringify(infoAgentResult, null, 2));
        console.log("--- End Full infoAgentResult --- ");
        // --- END: Log the entire infoAgentResult --- 

        // Use the text output directly, as the stricter prompt now seems to work
        gatheredInformation = infoAgentResult.text.trim();
        console.log("--- Gathered Information Text for Step 3b: ---");
        console.log(gatheredInformation);
        console.log("--- End Gathered Information Text --- ");

        if (!gatheredInformation || gatheredInformation.length === 0) {
            // Keep this check in case the text output is empty for some reason
            throw new Error("Agent failed to produce a text summary in Step 3a.");
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`--- Error during Step 3a (Information Gathering) for "${operation}":`, errorMessage);
        processingError = { operation, error: `Information Gathering Failed: ${errorMessage}` };
        // Skip Step 3b if information gathering failed
        gatheredInformation = null; 
    }

    // --- Step 3b: Iterative Generation & Validation using generateText --- 
    if (gatheredInformation) {
        console.log(`\n--- Starting Step 3b: Iterative Generation & Validation for: ${operation} ---`);
        try {
            // Define a toolset containing only the validation tool for this step
            const validationTool = { validate_openapi_schema: agentTools.validate_openapi_schema };
            
            // System Prompt for Iterative Validation
            const iterativeValidationSystemPrompt = `
Objective: Generate a valid OpenAPI Specification (OAS 3.x) JSON *string* for the operation based *only* on the provided information, ensuring it passes validation.

Process:
1.  Analyze the provided information.
2.  Generate a complete OAS JSON *string* representing only the described operation.
3.  Call the 'validate_openapi_schema' tool using the generated JSON string as the 'oas_json_string' parameter.
4.  If the tool returns { isValid: false, error: ... }, analyze the error message.
5.  Modify the JSON string to fix the validation error.
6.  Call 'validate_openapi_schema' again with the corrected string.
7.  Repeat steps 4-6 until the tool returns { isValid: true, error: null }.
8.  **CRITICAL FINAL OUTPUT:** Once validation succeeds, your final output MUST be ONLY the validated JSON string itself. Do not include *any* other text, explanations, or confirmations (e.g., do not say "Validation passed. Here is the JSON:"). Just output the raw, valid JSON string starting with { and ending with }.
`;

            const validationAgentResult = await generateText({
                model: anthropic('claude-3-7-sonnet-latest'), // Use Sonnet for better reasoning/iteration
                system: iterativeValidationSystemPrompt,
                prompt: `Generate and validate the OAS JSON string based on the following information:\n\nInformation:\n"""\n${gatheredInformation}\n"""`, 
                tools: validationTool, // Only provide the validation tool
                maxSteps: 10, // Allow more steps for potential iterations
            });

            // --- START: Extract Final Validated JSON Block --- 
            const rawOutput = validationAgentResult.text.trim(); 

            console.log(`--- Raw output from Step 3b (Validation) for \"${operation}\": ---`);
            console.log(rawOutput);
            console.log(`--- End raw output ---`);

            let jsonString: string | null = null;
            // Use regex to extract the JSON block as a final safeguard
            const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
            if (jsonMatch && jsonMatch[0]) {
                jsonString = jsonMatch[0];
                console.log("--- Extracted JSON string: ---");
                console.log(jsonString);
                console.log("--- End extracted JSON string ---");
            } else {
                console.error("Could not extract JSON block from final agent output.");
                throw new Error(`Agent output did not contain a recognizable JSON block. Output: ${rawOutput}`);
            }
            
            // We trust the iterative process handled validation, but parse one last time
            let parsedOAS: any;
            try {
                 parsedOAS = JSON.parse(jsonString);
            } catch (parseError) {
                console.error("Failed to parse final extracted JSON string:", parseError);
                 throw new Error(`Final extracted block was not valid JSON. Extracted: ${jsonString}`);
            }
            // --- END: Extract Final Validated JSON Block --- 

            if (typeof parsedOAS !== 'object' || parsedOAS === null || Object.keys(parsedOAS).length === 0) {
                throw new Error("Iterative generation resulted in an empty JSON object '{}'.");
            }

            generatedOASString = jsonString;
            console.log(`--- Successfully generated and validated JSON via iteration for operation: ${operation} ---`);

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`--- Error during Step 3b (Iterative Generation & Validation) for "${operation}":`, errorMessage);
            processingError = { operation, error: `Iterative Generation & Validation Failed: ${errorMessage}` };
        }
    }
    // End of Step 3 processing

    // --- Step 4: Return Single Result or Error ---
    console.log("\n--- Preparing final response ---");

    if (generatedOASString) {
        // Parse the successful string back into an object for the final response
        const finalSpec = JSON.parse(generatedOASString);
        console.log(`Successfully generated OAS for operation: ${operation}`);
        res.status(200).json({
            generated_spec: finalSpec // Return single spec object
        });
    } else if (processingError) {
        console.error(`Failed to generate OAS for operation: ${processingError.operation}`);
        // Return the specific error encountered
        res.status(500).json({
            error: `Failed to generate OpenAPI specification for operation: ${processingError.operation}`,
            details: processingError.error
        });
    } else {
        // This case should ideally not be reached if decomposition worked,
        // but included for robustness.
        console.error("Unknown error: No OAS generated and no specific processing error recorded.");
        res.status(500).json({
            error: 'An unexpected error occurred during processing.'
        });
    }

  } catch (error) {
    // Catch errors from intent check, decomposition, or unexpected issues
    console.error('Error in /api/generate-openapi handler:', error);
    res.status(500).json({ error: 'Internal Server Error during API processing.' });
  }
}));

/**
 * GET /health
 * Simple health check endpoint.
 */
app.get('/health', (req: Request, res: Response) => {
  res.status(200).send('OK');
});

// Start the server and listen on the defined port
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
}); 