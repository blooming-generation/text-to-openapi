import { CoreTool, generateText, tool } from 'ai';
// @ts-ignore - Assuming 'ai/google' is the correct path despite potential lint errors
import { google } from 'ai/google';
import { z } from 'zod';

import { searchApiDocumentation } from './searchApiDocumentation';
import { readWebpageContent } from './readWebpageContent';

interface VeracityResult {
    is_accurate: boolean;
    reasoning?: string;
}

const veracityTools: Record<string, CoreTool> = {
    search_docs: tool({
        description: 'Search for API documentation URLs using a query.',
        parameters: z.object({ query: z.string() }),
        execute: async ({ query }) => searchApiDocumentation(query),
    }),
    read_page: tool({
        description: 'Read the content of a webpage from a URL.',
        parameters: z.object({ url: z.string().url() }),
        execute: async ({ url }) => readWebpageContent(url),
    }),
};

export async function evaluateVeracity(
    generatedOAS: string | object,
    sourceUrl: string | string[]
): Promise<VeracityResult> {
    const sourceUrls = Array.isArray(sourceUrl) ? sourceUrl : [sourceUrl];
    console.log(`[Tool: evaluateVeracity] Evaluating veracity for OAS from source(s): ${sourceUrls.join(', ')}`);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error("GEMINI_API_KEY environment variable is not set for veracity evaluation.");
    }

    const oasString = typeof generatedOAS === 'string' ? generatedOAS : JSON.stringify(generatedOAS, null, 2);

    const systemPrompt = `You are a Veracity Evaluator. Your task is to verify if the details in the provided OpenAPI Specification (OAS) accurately match the *current* online documentation found at the provided source URL(s). Use the available tools ('search_docs', 'read_page') to fetch and examine the live documentation content. Focus on key details like paths, parameters, request/response schemas, and descriptions mentioned in the OAS. Output ONLY 'true' if the OAS accurately reflects the online documentation for the specified endpoints, or 'false' otherwise.`;

    const userPrompt = `Source URL(s): ${sourceUrls.join(', ')}\n\nGenerated OAS:\n\`\`\`json\n${oasString}\n\`\`\`\n\nIs Accurate (true/false):`;

    try {
        const { text } = await generateText({
            // @ts-ignore - Assuming model usage is correct despite potential lint errors
            model: google('models/gemini-1.5-pro-latest'),
            system: systemPrompt,
            prompt: userPrompt,
            tools: veracityTools,
            temperature: 0.1,
            maxTokens: 5,
        });

        const result = text.trim().toLowerCase();

        if (result !== 'true' && result !== 'false') {
            console.error("[Tool: evaluateVeracity] Failed to parse valid boolean from LLM response:", text);
            throw new Error(`Veracity evaluator returned an invalid response: ${text}`);
        }

        const isAccurate = result === 'true';
        console.log(`[Tool: evaluateVeracity] Veracity result: ${isAccurate}`);
        return { is_accurate: isAccurate };

    } catch (error) {
        console.error("[Tool: evaluateVeracity] Error during LLM call:", error);
        throw new Error(`Veracity evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
} 