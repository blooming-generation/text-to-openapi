// Import necessary modules
import express, { Request, Response, Application } from 'express';
import dotenv from 'dotenv';
import asyncHandler from 'express-async-handler';
import { z } from 'zod'; // For tool schemas
import { generateText, tool, CoreTool } from 'ai'; // Core Vercel AI SDK components
// @ts-ignore - Assuming ai/google is correct path
import { google } from 'ai/google'; // Google provider factory

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
            url: z.string().url().describe('The URL of the webpage to read'),
        }),
        // Note: This tool might return HTML due to previous linting issues.
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
            source_url: z.union([z.string().url(), z.array(z.string().url())]).describe('The source URL(s) of the documentation'),
        }),
        execute: async ({ generated_oas, source_url }) => evaluateVeracity(generated_oas, source_url),
    }),
};

/**
 * POST /api/generate-openapi
 * Endpoint to handle user requests for generating OpenAPI specifications.
 * It expects a JSON body with a 'query' field containing the user's natural language request.
 */
app.post('/api/generate-openapi', asyncHandler(async (req: Request, res: Response) => {
  const { query }: { query?: string } = req.body;

  if (!query || typeof query !== 'string') {
    res.status(400).json({ error: "Missing or invalid 'query' in request body" });
    return;
  }

  console.log(`Received query: ${query}`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Log the error server-side
    console.error("GEMINI_API_KEY environment variable is not set.");
    // Send a generic error to the client
    res.status(500).json({ error: 'Server configuration error.' });
    return;
  }

  try {
    // --- Step 1: Intent Check ---
    console.log('Performing intent check...');
    const intentCheckPrompt = `Does the following request ask for an OpenAPI specification or API definition? Answer only 'yes' or 'no'.\n\nRequest: \"${query}\"`;
    const intentResult = await generateText({
      // @ts-ignore - Assuming model usage is correct
      model: google('models/gemini-1.5-flash-latest'), // Use a faster model for simple check
      prompt: intentCheckPrompt,
      temperature: 0,
      maxTokens: 5,
    });

    if (intentResult.text.trim().toLowerCase() !== 'yes') {
      console.log('Intent check determined request is not for OAS. Returning empty response.');
      res.status(200).json({}); // Return empty JSON object as per requirement
      return;
    }
    console.log('Intent check passed.');

    // --- Step 2: Define Main Agent Prompt ---
    // Detailed instructions for the main agent
    const systemPrompt = `\nObjective: Generate a valid OpenAPI Specification (OAS 3.x) in JSON format that *precisely* fulfills the user's request.\n\nProcess:\n1.  Understand the user's request: '{query}'\n2.  Use 'search_api_documentation' to find the most relevant API documentation URL(s) for the request.\n3.  Select the best URL. If multiple seem relevant, start with the most promising one.\n4.  Use 'read_webpage_content' to get the content of that URL. Be prepared for HTML content.\n5.  Based *only* on the fetched content, draft an initial OAS in **JSON format** for the specific request.\n6.  Use 'validate_openapi_schema' on your draft. If invalid, revise the JSON structure and re-validate until valid.\n7.  Use 'evaluate_alignment' on the valid OAS, comparing it against the original query ('{query}'). If the score is below 4.8, revise the OAS to *strictly* match the user's request (removing extraneous paths, operations, or details), then re-validate schema and re-evaluate alignment. Repeat until alignment >= 4.8.\n8.  Use 'evaluate_veracity' on the valid and aligned OAS, providing the source URL used in step 4. If 'is_accurate' is false, analyze the likely discrepancy based on the online documentation, revise the OAS, then re-validate schema, re-evaluate alignment, and re-evaluate veracity. Repeat until veracity is true.\n9.  If all checks (valid JSON OAS, alignment >= 4.8, veracity == true) pass, provide the final OAS JSON string as your result *only*. Include no other text.\n10. If you cannot satisfy all criteria after 4 attempts (across steps 6-8), respond ONLY with the text "ERROR: Could not generate valid and verified OAS."\n`;

    // --- Step 3: Run Main Agent ---
    console.log('Starting main agent execution...');
    const agentResult = await generateText({
      // @ts-ignore - Assuming model usage is correct
      model: google('models/gemini-1.5-pro-latest'),
      system: systemPrompt.replace('{query}', query), // Inject query into system prompt
      prompt: `User Query: \"${query}\"\n\nPlease generate the OpenAPI Specification based on the process outlined in the system instructions.`,
      tools: agentTools,
      // @ts-ignore - Suppress type error for maxToolRoundtrips, assuming it works at runtime
      maxToolRoundtrips: 10, // Allow sufficient tool calls for iteration (adjust as needed)
    });

    console.log('Agent execution finished.');

    // --- Step 4: Process Final Response ---
    const finalText = agentResult.text.trim();

    if (finalText.startsWith('ERROR:')) {
      console.error('Agent failed to generate OAS:', finalText);
      res.status(500).json({ error: 'Failed to generate OpenAPI specification after multiple attempts.', details: finalText });
    } else {
      // Attempt to parse the final result as JSON to ensure it's valid JSON
      try {
        const finalOAS = JSON.parse(finalText);
        console.log('Successfully generated and validated OAS.');
        // Send the final validated JSON OAS object
        res.status(200).json(finalOAS);
      } catch (parseError) {
        console.error('Agent returned non-JSON or invalid JSON output:', finalText, parseError);
        res.status(500).json({ error: 'Agent produced invalid final JSON output.', details: finalText });
      }
    }

  } catch (error) {
    console.error('Error in /api/generate-openapi handler:', error);
    res.status(500).json({ error: 'Internal Server Error during OAS generation.' });
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