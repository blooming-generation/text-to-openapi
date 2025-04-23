// Import the SerpAPI client library
import { getJson } from "serpapi";

/**
 * Searches Google for API documentation related to a given query using SerpAPI.
 * @param query - The natural language query describing the desired API functionality.
 * @returns A promise that resolves to an array of potential documentation URLs.
 * @throws Throws an error if the SERPAPI_API_KEY is missing or if the search fails.
 */
export async function searchApiDocumentation(query: string): Promise<string[]> {
  console.log(`[Tool: searchApiDocumentation] Searching for query: "${query}"`);

  // Retrieve the SerpAPI key from environment variables
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    throw new Error("SERPAPI_API_KEY environment variable is not set.");
  }

  try {
    // Perform the search using SerpAPI
    // We add "API documentation" to focus the search
    const response = await getJson({
      api_key: apiKey,
      engine: "google",
      q: `${query} API documentation`,
      num: 5, // Limit to top 5 results for relevance
    });

    // Extract organic result URLs
    const urls = response.organic_results?.map((result: any) => result.link) || [];

    console.log(`[Tool: searchApiDocumentation] Found URLs: ${urls.join(', ')}`);
    return urls;

  } catch (error) {
    console.error("[Tool: searchApiDocumentation] Error searching with SerpAPI:", error);
    // Re-throw the error to be handled by the agent
    throw new Error(`SerpAPI search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
} 