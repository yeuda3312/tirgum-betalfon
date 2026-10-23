import express from "express";

const app = express();
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

const PORT = process.env.PORT || 3000;
const API_SECRET = process.env.API_SECRET;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

const LANGUAGES = {
  he: "Hebrew",
  en: "English",
  ar: "Arabic",
  fr: "French",
  es: "Spanish",
  de: "German",
  ru: "Russian",
  it: "Italian",
  yi: "Yiddish"
};

function authorized(req) {
  const supplied =
    req.get("x-api-key") ||
    req.query.key ||
    req.body?.key;

  return Boolean(
    API_SECRET && supplied && supplied === API_SECRET
  );
}

async function translate(text, source, target) {
  if (!GROQ_API_KEY) throw new Error("Missing GROQ_API_KEY");
  if (!LANGUAGES[source] || !LANGUAGES[target]) {
    throw new Error("Unsupported language");
  }

  if (source === target) return text;

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              `Translate from ${LANGUAGES[source]} to ${LANGUAGES[target]}. ` +
              "Return only the translation. Preserve meaning."
          },
          { role: "user", content: text }
        ],
        temperature: 0,
        max_tokens: 500
      })
    }
  );

  if (!response.ok) {
    const details = await response.text();
    console.error("Groq error:", response.status, details);
    throw new Error(`Groq error ${response.status}`);
  }

  const data = await response.json();
  const result = data.choices?.[0]?.message?.content?.trim();

  if (!result) throw new Error("Empty translation");
  return result;
}

function yemotResponse(text) {
  // Remove characters that may break the response format.
  const safe = String(text)
    .replace(/[\r\n]/g, " ")
    .replace(/[&=]/g, " ")
    .trim()
    .slice(0, 1200);

  return `id_list_message=t-${safe}`;
}

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "translator" });
});

app.all("/yemot", async (req, res) => {
  if (!authorized(req)) {
    console.error("Yemot authentication failed");
    return res.status(401).type("text/plain")
      .send("Unauthorized");
  }

  const params = {
    ...req.query,
    ...(req.method === "POST" ? req.body : {})
  };
  
console.log("Received parameter names:", Object.keys(params));
console.log("Voice fields:", {
  text: params.text,
  WORD: params.WORD,
  keys: Object.keys(params).filter(
    k => /text|word|voice|speech/i.test(k)
  )
});

  // Voice recognition in Yemot is expected in "text".
  // WORD is supported for compatibility with the old setup.
  const input = String(params.text ?? params.WORD ?? "").trim();
  const source = String(params.SOURCE || "he");
  const target = String(params.TARGET || "en");

  // Do not log the user's spoken text.
  console.log("Translation request received", {
    hasText: Boolean(input),
    source,
    target
  });

  if (!input) {
    return res.type("text/plain").send(
      "id_list_message=t-לא זוהה דיבור, נסו שוב"
    );
  }

  if (input.length > 2000) {
    return res.type("text/plain").send(
      "id_list_message=t-הטקסט ארוך מדי"
    );
  }

  try {
    const result = await translate(input, source, target);
    return res.type("text/plain").send(yemotResponse(result));
  } catch (err) {
    console.error("Translation failed:", err.message);
    return res.type("text/plain").send(
      "id_list_message=t-אירעה שגיאה בתרגום"
    );
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Translator listening on ${PORT}`);
});
