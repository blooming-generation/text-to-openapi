// Import the FirecrawlApp client
import FirecrawlApp from '@mendable/firecrawl-js';

/**
 * Reads the content of a given webpage using Firecrawl.
 * @param url - The URL of the webpage to read.
 * @returns A promise that resolves to the main content of the page in markdown.
 * @throws Throws an error if the FIRECRAWL_API_KEY is missing or if scraping fails.
 */
export async function readWebpageContent(url: string): Promise<string> {
  console.log(`[Tool: readWebpageContent] Reading URL: ${url}`);

  // Retrieve the Firecrawl API key from environment variables
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    // Throw error clearly if API key is missing
    throw new Error("Configuration error: FIRECRAWL_API_KEY environment variable is not set.");
  }

  // Initialize the Firecrawl client
  const app = new FirecrawlApp({ apiKey });

  try {
    // Assume scrapeUrl returns the 'data' object directly on success, 
    // or throws an error on failure (common SDK pattern).
    // We'll use 'any' again due to uncertainty about the exact success/error shape.
    const scrapeData: any = await app.scrapeUrl(url); 

    // Check if the returned object has the 'markdown' property.
    if (scrapeData && typeof scrapeData.markdown === 'string') {
        console.log(`[Tool: readWebpageContent] Successfully read main content (markdown) from ${url}`);
        return scrapeData.markdown;
    } 
    // Optional: Check for HTML as a fallback if markdown wasn't requested or available
    else if (scrapeData && typeof scrapeData.html === 'string') {
        console.warn(`[Tool: readWebpageContent] Markdown content not found for ${url}, returning HTML instead.`);
        return scrapeData.html; // Return HTML if markdown is missing
    } 
    else {
        // If we get here, the scrape succeeded but didn't return markdown or html in the expected format.
        console.error(`[Tool: readWebpageContent] Firecrawl scrape succeeded for ${url} but returned unexpected data structure:`, JSON.stringify(scrapeData, null, 2));
        throw new Error(`Firecrawl scrape for ${url} returned unexpected data structure.`);
    }

  } catch (error) {
    // Catch errors thrown by FirecrawlApp (e.g., network errors, API errors, scraping failures)
    console.error(`[Tool: readWebpageContent] Error during Firecrawl scrape for ${url}:`, error);
    // Re-throw the error with context
    throw new Error(`Firecrawl processing failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
} 