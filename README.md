# text-to-openapi

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A simple Node.js service that uses AI to generate an OpenAPI Specification (OAS) in JSON format based on a natural language request about a specific API endpoint.

## Overview

You provide a natural language query like "I want to list my Stripe refunds", and the service uses a combination of:

*   **Google Gemini 1.5 Pro:** As the primary Large Language Model (LLM).
*   **Vercel AI SDK:** To orchestrate the LLM interaction and tool usage.
*   **SerpAPI:** For searching Google for relevant API documentation URLs.
*   **Firecrawl:** For scraping the content of documentation webpages.
*   **Swagger Parser:** For validating the generated OAS.
*   **Internal Evaluator Agents (using Gemini):**
    *   An "Alignment Evaluator" to ensure the OAS strictly matches the user's specific request.
    *   A "Veracity Evaluator" to check the generated OAS details against live documentation using the search/scrape tools.

The service performs an iterative process involving searching, reading, generating, validating, and evaluating until a valid, aligned, and verified OAS (in JSON format) matching the request is produced, or it determines it cannot fulfill the request accurately.

## Features

*   Natural language input to generate specific OpenAPI endpoint definitions.
*   Multi-tool agent architecture (search, scrape, validate, evaluate).
*   Iterative refinement process for improved accuracy and relevance.
*   Alignment and Veracity checks using dedicated LLM evaluations.
*   JSON-only OpenAPI 3.x output.

## Prerequisites

*   Node.js (v18.11+ recommended for `pnpm dev` watch mode)
*   pnpm package manager (or npm/yarn, adjust commands accordingly)
*   API Keys:
    *   Google Gemini API Key (from [Google AI Studio](https://aistudio.google.com/) or Google Cloud)
    *   SerpAPI API Key (from [serpapi.com](https://serpapi.com/))
    *   Firecrawl API Key (from [firecrawl.dev](https://firecrawl.dev/))

## Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/blooming-generation/text-to-openapi.git
    cd text-to-openapi
    ```

2.  **Install dependencies:**
    ```bash
    pnpm install
    ```

3.  **Set up environment variables:**
    *   Copy the example environment file:
        ```bash
        cp .env.example .env
        ```
    *   Edit the `.env` file and add your API keys:
        ```dotenv
        GEMINI_API_KEY=YOUR_GEMINI_API_KEY
        SERPAPI_API_KEY=YOUR_SERPAPI_API_KEY
        FIRECRAWL_API_KEY=YOUR_FIRECRAWL_API_KEY
        # Optional: PORT=3001
        ```

## Running the Service

1.  **Build the TypeScript code:**
    ```bash
    pnpm build
    ```

2.  **Start the server:**
    ```bash
    pnpm start
    ```
    The server will start, typically on port 3000 (or the port specified in `.env`).

3.  **Development Mode (Optional):**
    For development, you can use the `dev` script which watches for file changes, recompiles, and restarts the server:
    ```bash
    pnpm dev
    ```

## API Usage

Send a `POST` request to the `/api/generate-openapi` endpoint with a JSON body containing your natural language query.

**Request:**

*   **Method:** `POST`
*   **URL:** `http://localhost:3000/api/generate-openapi` (adjust port if needed)
*   **Headers:** `Content-Type: application/json`
*   **Body:**
    ```json
    {
      "query": "Give me the OpenAPI spec for listing Stripe refunds"
    }
    ```

**Success Response (200 OK):**

The response body will contain the generated OpenAPI specification in JSON format if successful.

```json
{
  "openapi": "3.0.0",
  "info": {
    "title": "Stripe API - List Refunds",
    "version": "1.0.0"
  },
  "paths": {
    "/v1/refunds": {
      "get": {
        "summary": "List all refunds",
        "operationId": "getListRefunds",
        "parameters": [
          // ... parameters like limit, starting_after, etc. ...
        ],
        "responses": {
          "200": {
            "description": "A list of refunds.",
            "content": {
              "application/json": {
                "schema": {
                  // ... schema definition ...
                }
              }
            }
          }
        }
      }
    }
  }
}
```

**Empty Response (200 OK):**

If the initial intent check determines the query is not asking for an OpenAPI spec, an empty JSON object `{}` is returned.

**Error Response (4xx or 5xx):**

If an error occurs (e.g., missing query, server configuration error, failure to generate OAS after retries), the response will contain an error message.

```json
{
  "error": "Failed to generate OpenAPI specification after multiple attempts.",
  "details": "ERROR: Could not generate valid and verified OAS."
}
```

## Known Issues & Considerations

*   **`readWebpageContent.ts`:** This tool currently accesses scraped content via `.data.content` due to persistent linter errors with the `@mendable/firecrawl-js@1.24.0` types. This assumes HTML output. If Markdown is strictly needed or runtime errors occur, this tool may need revisiting based on updated library documentation.
*   **Vercel AI SDK Type Conflicts:** `@ts-ignore` comments are used in `src/tools/evaluate*.ts` and `src/index.ts` for Vercel AI SDK `google` provider imports/usage and the `maxToolRoundtrips` parameter where current type definitions seem to conflict with documented functionality. These might need adjustment based on future SDK updates.
*   **Prompt Sensitivity:** The quality of the generated OAS heavily depends on the quality of the online documentation found and the effectiveness of the internal LLM prompts. Prompts may require tuning for complex APIs or poorly structured documentation.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.