import * as http from "http";
import * as https from "https";
import { URL } from "url";

export type AIInput = {
  prompt: string;
  apiKey: string;
  endpoint: string;
  model: string;
  timeoutMs: number;
};

export interface AIProvider {
  generatePRDescription(input: AIInput): Promise<string>;
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  const lines = trimmed.split(/\r?\n/);
  if (lines.length <= 2) {
    return trimmed;
  }
  return lines.slice(1, -1).join("\n").trim();
}

function postJson(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === "https:";
    const client = isHttps ? https : http;

    const options: http.RequestOptions = {
      method: "POST",
      hostname: parsedUrl.hostname,
      port: parsedUrl.port ? Number(parsedUrl.port) : isHttps ? 443 : 80,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      headers: {
        ...headers,
        "Content-Length": Buffer.byteLength(body).toString(),
      },
    };

    const request = client.request(options, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      response.on("end", () => {
        const responseBody = Buffer.concat(chunks).toString("utf8");
        resolve({
          statusCode: response.statusCode ?? 0,
          body: responseBody,
        });
      });
    });

    request.on("error", (error) => {
      reject(error);
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("Request timed out"));
    });

    request.write(body);
    request.end();
  });
}

class OpenAICompatibleProvider implements AIProvider {
  async generatePRDescription(input: AIInput): Promise<string> {
    const payload = JSON.stringify({
      model: input.model,
      messages: [
        {
          role: "system",
          content:
            "You are a senior engineer writing concise, reviewer-friendly PR descriptions.",
        },
        { role: "user", content: input.prompt },
      ],
      temperature: 0.2,
    });

    const response = await postJson(
      input.endpoint,
      {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
      },
      payload,
      input.timeoutMs
    );

    let data: unknown;
    try {
      data = JSON.parse(response.body);
    } catch (error) {
      throw new Error("AI response was not valid JSON.");
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const errorMessage =
        (data as { error?: { message?: string } })?.error?.message ||
        `AI request failed (${response.statusCode}).`;
      throw new Error(errorMessage);
    }

    const content =
      (
        data as {
          choices?: Array<{ message?: { content?: string }; text?: string }>;
        }
      )?.choices?.[0]?.message?.content ||
      (data as { choices?: Array<{ text?: string }> })?.choices?.[0]?.text;

    if (!content) {
      throw new Error("AI response did not include any content.");
    }

    return stripMarkdownFences(content);
  }
}

export function createProvider(providerId: string): AIProvider {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === "openai") {
    return new OpenAICompatibleProvider();
  }
  throw new Error(`Unsupported AI provider: ${providerId}`);
}
