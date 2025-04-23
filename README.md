# text-to-openapi

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Node.js service using AI to generate an OpenAPI Specification (OAS) fragment for a *single* API operation based on a natural language request.

## Overview

You provide a natural language query describing one or more API operations (e.g., "Generate an OpenAPI spec for the Stripe Refund API, including operations for creating and retrieving refunds"). The service currently focuses on the **first operation identified** ("Create a refund" in the example) and uses a multi-step AI process:

1.  **Intent Check & Decomposition (Claude 3.5 Haiku):** Verifies the request is for an API spec and breaks it down into distinct operations. Selects the first operation for processing.
2.  **Information Gathering (Claude 3.7 Sonnet + Tools):**
    *   Uses `search_api_documentation` (SerpAPI) to find relevant documentation URLs for the target operation.
    *   Uses `read_webpage_content` (Firecrawl) to scrape the content of those pages.
    *   Summarizes the gathered factual information (method, path, params, responses) into a text block.
3.  **JSON Generation (Claude 3.7 Sonnet):**
    *   Takes the text summary from the previous step.
    *   Uses `generateObject` with a defined OAS schema to structure the information into a valid OAS JSON fragment for the single operation.
4.  **(Optional) Iterative Validation (Self-Correction - *Currently Disabled*):** *Previous iterations involved a step where the model used a `validate_openapi_schema` tool (Swagger Parser) to validate and potentially correct its own JSON output iteratively. This has been replaced by the direct `generateObject` approach in step 3.*

The final result is a single OAS JSON fragment representing the first identified operation.

## Features

*   Natural language input to generate specific OpenAPI operation definitions.
*   Multi-step, multi-model agent architecture (Anthropic models, Search, Scrape).
*   Focuses on generating a spec for the first identified API operation in a query.
*   JSON-only OpenAPI 3.x output fragment.

## Prerequisites

*   Node.js (v18.11+ recommended)
*   pnpm package manager (or npm/yarn, adjust commands accordingly)
*   API Keys:
    *   Anthropic API Key (from [anthropic.com](https://console.anthropic.com/))
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
        # Required
        ANTHROPIC_API_KEY=YOUR_ANTHROPIC_API_KEY
        SERPAPI_API_KEY=YOUR_SERPAPI_API_KEY
        FIRECRAWL_API_KEY=YOUR_FIRECRAWL_API_KEY

        # Optional - Defaults to 3000
        # PORT=3001
        ```

## Running the Service

1.  **Build the TypeScript code:**
    ```bash
    pnpm run clean && pnpm run build
    ```

2.  **Start the server:**
    ```bash
    pnpm start
    ```
    The server will start, typically on port 3000 (or the port specified in `.env`).

3.  **Development Mode (Optional):**
    Watches for changes, recompiles, and restarts the server:
    ```bash
    pnpm run dev
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
      "query": "Generate an OpenAPI spec for the Stripe Refund API, including operations for creating and retrieving refunds."
    }
    ```

**Success Response (200 OK):**

The response body contains the generated OAS fragment for the *first* operation identified in the query.

```json
{
  "generated_spec": {
    "openapi": "3.0.0",
    "info": {
      "title": "Stripe API",
      "version": "1.0.0",
      "description": "API for Stripe payment processing"
    },
    "paths": {
      "/v1/refunds": {
        "post": {
          "summary": "Create a Stripe refund",
          // ... rest of the generated operation spec ...
        }
      }
    }
    // ... potentially components etc. ...
  }
}
```

**Empty Response (200 OK):**

If the initial intent check determines the query is not asking for an API spec, an empty JSON object `{}` is returned.

**Error Response (4xx or 5xx):**

If an error occurs (e.g., missing query, setup error, failure in generation steps), the response contains an error message.

```json
{
  "error": "Failed to generate OpenAPI specification for operation: Create a refund",
  "details": "JSON Generation Failed: JSON generation step produced an empty object '{}'."
}
```
```json
{
  "error": "Could not understand the specific API operations requested in the query."
}
```

## Known Issues & Considerations

*   **Single Operation Focus:** Currently only processes the first operation identified in the decomposition step.
*   **Tool Reliability:** Depends heavily on the quality and accessibility of online documentation found by search and scraped by Firecrawl. Poorly structured or heavily Javascript-rendered sites may yield poor results.
*   **Model Limitations:** The final structuring step relies on the LLM's ability to interpret the gathered text and map it to the OAS schema. Complex information might still lead to errors or incomplete specs.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.