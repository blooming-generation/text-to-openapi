// Import the swagger-parser library
import SwaggerParser from "swagger-parser";

/**
 * Defines the structure for the validation result.
 */
interface ValidationResult {
  isValid: boolean;
  error: string | null;
}

/**
 * Validates a string input to check if it's a valid OpenAPI Specification (OAS) in JSON format.
 * @param oasJsonString - The string containing the potential OpenAPI specification (expected to be JSON).
 * @returns A promise that resolves to a ValidationResult object.
 */
export async function validateOpenAPISchema(oasJsonString: string): Promise<ValidationResult> {
  console.log("[Tool: validateOpenAPISchema] Attempting to validate OAS JSON string.");

  let parsedSchema: object;

  // Attempt to parse the input string as JSON
  try {
    parsedSchema = JSON.parse(oasJsonString);
    console.log("[Tool: validateOpenAPISchema] Parsed input as JSON.");
    // Ensure it's an object after parsing
    if (typeof parsedSchema !== 'object' || parsedSchema === null) {
        throw new Error('Parsed JSON is not an object.');
    }
  } catch (jsonError) {
      console.error("[Tool: validateOpenAPISchema] Failed to parse input as JSON.", jsonError);
      return { isValid: false, error: "Input string is not valid JSON." };
  }

  // Attempt to validate the parsed schema using SwaggerParser
  try {
    // Use SwaggerParser.validate() on the parsed object.
    // Use type assertion (as any) as a workaround for potential type definition issues with the static method.
    await (SwaggerParser as any).validate(parsedSchema);

    console.log("[Tool: validateOpenAPISchema] OAS validation successful.");
    return { isValid: true, error: null };
  } catch (validationError) {
    // Log the validation error
    console.error("[Tool: validateOpenAPISchema] OAS validation failed:", validationError);
    // Return validation failure with the error message
    const errorMessage = validationError instanceof Error ? validationError.message : String(validationError);
    return { isValid: false, error: `OAS validation failed: ${errorMessage}` };
  }
} 