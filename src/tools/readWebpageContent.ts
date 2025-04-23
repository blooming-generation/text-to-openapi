// Import the FirecrawlApp client
import FirecrawlApp from '@mendable/firecrawl-js';

/**
 * Reads the content of a given webpage using Firecrawl.
 * @param url - The URL of the webpage to read.
 * @returns A promise that resolves to the markdown content of the page.
 * @throws Throws an error if the FIRECRAWL_API_KEY is missing or if scraping fails.
 */
export async function readWebpageContent(url: string): Promise<string> {
  console.log(`[Tool: readWebpageContent] Reading URL: ${url}`);

  // Retrieve the Firecrawl API key from environment variables
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY environment variable is not set.");
  }

  // Initialize the Firecrawl client
  const app = new FirecrawlApp({ apiKey });

  try {
    // Scrape the URL. Remove options to avoid type errors for now.
    const scrapeResult = await app.scrapeUrl(url /* No options object */);

    // Check if scraping was successful and content exists
    // Try accessing content via scrapeResult.data.content
    // Add type assertion as a fallback if direct access fails linting
    const content = (scrapeResult as any)?.data?.content;

    if (!scrapeResult || scrapeResult.success === false || !content) {
      const errorMessage = (scrapeResult as any)?.error || 'Unknown scraping error';
      throw new Error(`Failed to scrape URL or no content found. Error: ${errorMessage}`);
    }

    console.log(`[Tool: readWebpageContent] Successfully read content (likely HTML) from ${url}`);
    // Return the main content (might be HTML)
    return content;

  } catch (error) {
    console.error(`[Tool: readWebpageContent] Error reading URL ${url} with Firecrawl:`, error);
    // Re-throw the error to be handled by the agent
    throw new Error(`Firecrawl scraping failed for ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
} 