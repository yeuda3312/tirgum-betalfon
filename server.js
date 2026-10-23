import express from "express";

const app = express();

app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: false, limit: "32kb" }));

const PORT = process.env.PORT || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const API_SECRET = process.env.API_SECRET;

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
    API_SECRET &&
    supplied &&
    supplied === API_SECRET
  );
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "yemot-translator"
  });
});

async function translate(text, source, target) {
  if (!GROQ_API_KEY) {
    throw new Error("Missing GROQ_API_KEY");
  }

  if (!LANGUAGES[source] || !LANGUAGES[target]) {
    throw new Error("Unsupported language");
  }

  if (source === target) {
    return text;
  }

  const response = await fetch(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model:
          process.env.GROQ_MODEL ||
          "llama-3.3-70b-versatile",
        messages: [
          {
            role: "system",
            content:
              `Translate the following text from ${LANGUAGES[source]} ` +
              `to ${LANGUAGES[target]}. Return only the translation. ` +
              "Preserve the meaning. For a single word, return its " +
              "most common translation. If ambiguous, choose the " +
              "most common meaning."
          },
          {
            role: "user",
            content: text
          }
        ],
        temperature: 0,
        max_tokens: 400
      })
    }
  );

  if (!response.ok) {
    console.error(
      "Groq request failed:",
      response.status,
      await response.text()
    );
    throw new Error("Translation provider error");
  }

  const data = await response.json();
  const result =
    data.choices?.[0]?.message?.content?.trim();

  if (!result) {
    throw new Error("Empty translation");
  }

  return result;
}

function yemotTtsResponse(text) {
  const safeText = String(text)
    .replace(/[\r\n]/g, " ")
    .replace(/[&=]/g, " ")
    .trim()
    .slice(0, 1200);

  return `id_list_message=t-${safeText}`;
}

app.post("/translate", async (req, res) => {
  if (!authorized(req)) {
    return res.status(401).json({
      error: "Unauthorized"
    });
  }

  const {
    text,
    source = "en",
    target = "he"
  } = req.body;

  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > 2000
  ) {
    return res.status(400).json({
      error: "Invalid text"
    });
  }

  try {
    const result = await translate(
      text.trim(),
      source,
      target
    );

    return res.json({
      ok: true,
      translation: result
    });
  } catch (error) {
    console.error(error.message);

    return res.status(502).json({
      error: "Translation failed"
    });
  }
});

app.all("/yemot", async (req, res) => {
  if (!authorized(req)) {
    return res.status(401).type("text/plain")
      .send("Unauthorized");
  }

  const params = {
    ...req.query,
    ...(req.method === "POST" ? req.body : {})
  };

  const text = String(params.WORD || "").trim();
  const source = String(params.SOURCE || "en");
  const target = String(params.TARGET || "he");

  if (!text) {
    return res.type("text/plain").send(
      "id_list_message=t-לא התקבלה מילה לתרגום"
    );
  }

  if (text.length > 2000) {
    return res.type("text/plain").send(
      "id_list_message=t-הטקסט ארוך מדי"
    );
  }

  try {
    const result = await translate(
      text,
      source,
      target
    );

    return res.type("text/plain").send(
      yemotTtsResponse(result)
    );
  } catch (error) {
    console.error(error.message);

    return res.type("text/plain").send(
      "id_list_message=t-אירעה שגיאה בתרגום, נסו שוב"
    );
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Translator server listening on port ${PORT}`
  );
});
