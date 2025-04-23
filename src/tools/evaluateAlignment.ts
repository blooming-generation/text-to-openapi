import { generateText } from 'ai';
// Remove or keep Google import based on whether it's needed elsewhere
// import { google } from '@ai-sdk/google'; 
import { anthropic } from '@ai-sdk/anthropic'; // Add Anthropic import

// Define the structure for the alignment evaluation result
interface AlignmentResult {
    score: number; // Score between 0.0 and 5.0
    reasoning?: string; // Optional reasoning from the evaluator
}

/**
 * Evaluates the alignment between a user query and a generated OpenAPI Specification (OAS).
 * Uses an internal LLM call (Claude Haiku) configured as an 'Alignment Evaluator'.
 *
 * @param userQuery - The original user query.
 * @param generatedOAS - The generated OpenAPI specification (as a JSON string or object).
 * @returns A promise that resolves to an AlignmentResult object.
 * @throws Throws an error if the evaluation fails (API key check handled by provider).
 */
export async function evaluateAlignment(
    userQuery: string,
    generatedOAS: string | object
): Promise<AlignmentResult> {
    console.log("[Tool: evaluateAlignment] Evaluating alignment for query:", userQuery);

    // Ensure OAS is stringified for the prompt
    const oasString = typeof generatedOAS === 'string' ? generatedOAS : JSON.stringify(generatedOAS, null, 2);

    // Log the OAS string being sent to the evaluator
    console.log("[Tool: evaluateAlignment] OAS being evaluated:\n", oasString); 

    // Define the system prompt for the Alignment Evaluator LLM
    const systemPrompt = `You are an Alignment Evaluator. Your task is to assess if the provided OpenAPI Specification (OAS) strictly and accurately represents *only* the specific functionality requested by the user query. Look for any extra or missing endpoints, operations, or details in the OAS. Output ONLY a single floating-point number between 0.0 and 5.0 representing the alignment score. A score of 5.0 means perfect alignment with the specific request, while 0.0 means no alignment.`;

    // Define the user prompt containing the query and the OAS
    const userPrompt = `User Query: "${userQuery}"\n\nGenerated OAS:\n\`\`\`json\n${oasString}\n\`\`\`\n\nAlignment Score (0.0-5.0):`;

    try {
        // Make the internal LLM call using Vercel AI SDK's generateText
        const { text } = await generateText({
            // Switch to Claude Haiku
            model: anthropic('claude-3-5-haiku-latest'),
            system: systemPrompt,
            prompt: userPrompt,
            temperature: 0.1,
        });

        // Log the raw text output from the evaluator LLM
        console.log("[Tool: evaluateAlignment] Raw LLM text response:", JSON.stringify(text)); // Stringify raw text

        // Parse the score from the response text
        const score = parseFloat(text.trim());

        // Validate the score
        if (isNaN(score) || score < 0.0 || score > 5.0) {
            console.error("[Tool: evaluateAlignment] Failed to parse valid score from LLM response:", text);
            throw new Error(`Alignment evaluator returned an invalid score: ${text}`);
        }

        console.log(`[Tool: evaluateAlignment] Alignment score: ${score}`);
        return { score };

    } catch (error) {
        console.error("[Tool: evaluateAlignment] Error during LLM call:", error);
        throw new Error(`Alignment evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
} 