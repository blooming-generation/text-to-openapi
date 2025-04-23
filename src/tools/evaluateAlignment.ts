import { generateText } from 'ai';
// @ts-ignore - Assuming 'ai/google' is the correct path despite potential lint errors
import { google } from 'ai/google';

// Define the structure for the alignment evaluation result
interface AlignmentResult {
    score: number; // Score between 0.0 and 5.0
    reasoning?: string; // Optional reasoning from the evaluator
}

/**
 * Evaluates the alignment between a user query and a generated OpenAPI Specification (OAS).
 * Uses an internal LLM call (Gemini) configured as an 'Alignment Evaluator'.
 *
 * @param userQuery - The original user query.
 * @param generatedOAS - The generated OpenAPI specification (as a JSON string or object).
 * @returns A promise that resolves to an AlignmentResult object.
 * @throws Throws an error if the GEMINI_API_KEY is missing or if the evaluation fails.
 */
export async function evaluateAlignment(
    userQuery: string,
    generatedOAS: string | object
): Promise<AlignmentResult> {
    console.log("[Tool: evaluateAlignment] Evaluating alignment for query:", userQuery);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is not set for alignment evaluation.");
    }

    // Ensure OAS is stringified for the prompt
    const oasString = typeof generatedOAS === 'string' ? generatedOAS : JSON.stringify(generatedOAS, null, 2);

    // Define the system prompt for the Alignment Evaluator LLM
    const systemPrompt = `You are an Alignment Evaluator. Your task is to assess if the provided OpenAPI Specification (OAS) strictly and accurately represents *only* the specific functionality requested by the user query. Ignore any extra endpoints, operations, or details in the OAS that were not directly asked for in the query. Output ONLY a single floating-point number between 0.0 and 5.0 representing the alignment score. A score of 5.0 means perfect alignment with the specific request, while 0.0 means no alignment.`;

    // Define the user prompt containing the query and the OAS
    const userPrompt = `User Query: "${userQuery}"\n\nGenerated OAS:\n\`\`\`json\n${oasString}\n\`\`\`\n\nAlignment Score (0.0-5.0):`;

    try {
        // Make the internal LLM call using Vercel AI SDK's generateText
        const { text } = await generateText({
            // @ts-ignore - Assuming model usage is correct despite potential lint errors
            model: google('models/gemini-1.5-pro-latest'), // Use appropriate Gemini model
            system: systemPrompt,
            prompt: userPrompt,
            temperature: 0.1, // Low temperature for deterministic score output
            maxTokens: 10, // Score is short
        });

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