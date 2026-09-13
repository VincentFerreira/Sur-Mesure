import { GoogleGenAI, Type } from "@google/genai";
import Anthropic from "@anthropic-ai/sdk";
import { CVData, ATSAnalysisResult, ATSKeyword, JobWorkMode, JobContractType } from "../types";
import { getLangText, getLangArray, LANGUAGE_CODES } from '../lib/i18n';

// Types pour le provider IA
export type AIProvider = 'gemini' | 'claude' | 'fake';

export function atsProviderModel(provider: AIProvider): string {
    if (provider === 'claude') return 'claude-sonnet-4-6';
    if (provider === 'fake') return 'fake-keyword-match-v1';
    return 'gemini';
}

// Flash(-lite) models can fully disable "thinking" (budget 0); Pro-tier models require
// a non-zero budget and reject 0 outright. Disabling it on flash frees the model's whole
// output-token budget for the actual JSON instead of internal reasoning. For pro-tier
// fallbacks, cap the budget instead of leaving it unset — an unset budget defaults to
// dynamic/unbounded thinking, which can itself eat most of maxOutputTokens and leave too
// little room for the actual JSON, which is what was causing very long CV/job-description
// pairs to hit the token cap and come back as truncated, unparsable JSON.
const thinkingConfigFor = (model: string) => ({ thinkingBudget: model.includes('flash') ? 0 : 2048 });

// AI responses are occasionally truncated mid-output when they hit the model's output
// token cap (very long CV + job description, or a model that ignores brevity
// instructions) — JSON.parse then fails with a cryptic "Unterminated string" error.
// `wasTruncated` should reflect the provider's own stop/finish reason where the caller
// can determine it, so the message only claims "cut off" when that's actually what
// happened rather than for any malformed-JSON response.
const parseAiJson = (text: string, context: string, wasTruncated: boolean = true): any => {
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(
            wasTruncated
                ? `The ${context} response was cut off before it finished (likely too long to fit the model's output limit) and could not be parsed. Try again, or with a shorter/more concise job description.`
                : `The ${context} response wasn't valid JSON and could not be parsed. Please try again.`
        );
    }
};

// Prompt partagé pour l'extraction de CV
const RESUME_PARSER_PROMPT = `You are an expert resume parser. Extract information from the PDF resume into the JSON structure below.

CRITICAL RULES — each field must contain ONE piece of information only, never multiple:
- "firstName": ONLY the given name (e.g. "Vincent")
- "lastName": ONLY the family name (e.g. "FERREIRA")
- "title": ONLY the professional job title line (e.g. "Lead QA Engineer | Test Automation | CI/CD"). Do NOT include location, email, phone, URLs or any other contact info here.
- "email": ONLY the email address (e.g. "john@example.com")
- "medium": ONLY the Medium blog URL if present, else empty string
- "location": ONLY the city / country (e.g. "Paris, France")
- "linkedin": ONLY the LinkedIn profile URL
- "github": ONLY the GitHub profile URL, else empty string
- "summary": ONLY the professional summary paragraph(s). Do NOT include skills, experience or education here.
- skills[].name: ONLY the skill category label (e.g. "Testing Expertise")
- skills[].items: comma-separated skills for that category only (e.g. "Playwright, Cypress, Selenium")
- experience[].role: ONLY the job title (e.g. "Lead Quality Assurance Engineer")
- experience[].company: ONLY the company name (e.g. "Comet")
- experience[].location: ONLY the city (e.g. "Paris (Remote)")
- experience[].startDate: ONLY the start date (e.g. "2019-08")
- experience[].endDate: ONLY the end date or "Present"
- experience[].description: array of bullet point strings, one string per bullet
- experience[].techStack: comma-separated tech tags only (e.g. "Playwright, Cypress, GitLab CI")
- education[].school: ONLY the school name
- education[].degree: ONLY the degree / diploma name
- education[].startDate / endDate: year only (e.g. "2008")
- languages[]: each entry is one language with proficiency (e.g. "French (Native)")

Return valid JSON only. No markdown, no code blocks, no extra keys.`;

// Instance Gemini
const geminiAi = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Instance Claude
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    dangerouslyAllowBrowser: true
});

// Pinned to the cheapest tier on purpose — do not swap for a pricier model (e.g. a
// "-flash" or "-pro" variant) without confirming the cost tradeoff first.
const GEMINI_MODEL = 'gemini-3.1-flash-lite';

let cachedGeminiModel: string | null = null;
// The API's own outputTokenLimit for GEMINI_MODEL (65536 as of writing) — far above the
// small fixed caps this code used to hardcode, which is what was causing large CV/job-
// description pairs to come back truncated even though the model itself had plenty of
// budget left. Falls back to a conservative default if the lookup below fails.
let cachedGeminiOutputLimit: number | null = null;
const DEFAULT_GEMINI_OUTPUT_LIMIT = 8192;

const getBestGeminiModel = async (): Promise<string> => {
    if (cachedGeminiModel) return cachedGeminiModel;

    const apiKey = process.env.API_KEY;

    // Tracks the most informative failure seen across both API versions, so that if
    // neither call finds the model we can report *why* (auth vs. network vs. genuinely
    // absent) instead of always blaming "model not available" — a 401/403 here means the
    // key itself is rejected and every model call downstream will fail the same way.
    let lastAuthError: { status: number; reason?: string } | null = null;
    let lastNetworkError: unknown = null;

    for (const apiVersion of ['v1', 'v1beta']) {
        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/${apiVersion}/models?key=${apiKey}`
            );
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                    let reason: string | undefined;
                    try {
                        const errBody = await res.json();
                        reason = errBody?.error?.status ?? errBody?.error?.details?.[0]?.reason;
                    } catch { /* body not JSON, ignore */ }
                    lastAuthError = { status: res.status, reason };
                }
                continue;
            }
            const data = await res.json();
            const models: Array<{ name: string; supportedGenerationMethods?: string[]; outputTokenLimit?: number }> = data.models ?? [];
            const match = models.find(m => m.name.replace('models/', '') === GEMINI_MODEL
                && m.supportedGenerationMethods?.includes('generateContent'));
            if (match) {
                cachedGeminiModel = GEMINI_MODEL;
                cachedGeminiOutputLimit = match.outputTokenLimit ?? DEFAULT_GEMINI_OUTPUT_LIMIT;
                console.log('[Gemini] Modèle :', cachedGeminiModel, '| outputTokenLimit:', cachedGeminiOutputLimit);
                return cachedGeminiModel;
            }
        } catch (err) {
            lastNetworkError = err;
        }
    }

    if (lastAuthError) {
        throw new Error(
            `Clé API Gemini invalide ou rejetée par Google (HTTP ${lastAuthError.status}`
            + (lastAuthError.reason ? ` — ${lastAuthError.reason}` : '')
            + `). Vérifiez GEMINI_API_KEY dans .env.local (une clé AI Studio valide `
            + `commence par "AIzaSy"), puis redémarrez le serveur.`
        );
    }
    if (lastNetworkError) {
        throw new Error(
            `Impossible de contacter l'API Gemini pour vérifier le modèle "${GEMINI_MODEL}" `
            + `(erreur réseau : ${lastNetworkError instanceof Error ? lastNetworkError.message : String(lastNetworkError)}).`
        );
    }
    throw new Error(`Le modèle Gemini "${GEMINI_MODEL}" n'est pas disponible avec cette clé API.`);
};

// Leaves headroom below the model's hard cap (some of that ceiling can be consumed by
// internal accounting even at thinkingBudget 0) while still using the vast majority of
// what the model actually supports, instead of a small hardcoded number.
const geminiMaxOutputTokens = (): number => {
    const limit = cachedGeminiOutputLimit ?? DEFAULT_GEMINI_OUTPUT_LIMIT;
    return Math.max(4096, limit - 2048);
};

// Parse avec Gemini
const parseWithGemini = async (pdfBase64: string): Promise<any> => {
    const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, "");
    const model = await getBestGeminiModel();

    const response = await geminiAi.models.generateContent({
        model,
        contents: {
            parts: [
                {
                    inlineData: {
                        mimeType: "application/pdf",
                        data: cleanBase64
                    }
                },
                {
                    text: RESUME_PARSER_PROMPT
                }
            ]
        },
        config: {
            responseMimeType: "application/json",
            thinkingConfig: thinkingConfigFor(model),
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    personalInfo: {
                        type: Type.OBJECT,
                        properties: {
                            firstName: { type: Type.STRING, description: "Given name only, e.g. 'Vincent'" },
                            lastName:  { type: Type.STRING, description: "Family name only, e.g. 'FERREIRA'" },
                            title:     { type: Type.STRING, description: "Professional job title only, e.g. 'Lead QA Engineer | Test Automation'. No location, email or URLs." },
                            email:     { type: Type.STRING, description: "Email address only, e.g. 'john@example.com'" },
                            medium:    { type: Type.STRING, description: "Medium blog URL only, or empty string" },
                            location:  { type: Type.STRING, description: "City/country only, e.g. 'Paris, France'" },
                            linkedin:  { type: Type.STRING, description: "LinkedIn profile URL only" },
                            github:    { type: Type.STRING, description: "GitHub profile URL only, or empty string" },
                            summary:   { type: Type.STRING, description: "Professional summary paragraph(s) only. No skills or experience bullets." },
                        }
                    },
                    skills: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                name: { type: Type.STRING },
                                items: { type: Type.STRING }
                            }
                        }
                    },
                    experience: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                role: { type: Type.STRING },
                                company: { type: Type.STRING },
                                location: { type: Type.STRING },
                                startDate: { type: Type.STRING },
                                endDate: { type: Type.STRING },
                                description: { type: Type.ARRAY, items: { type: Type.STRING } },
                                techStack: { type: Type.STRING }
                            }
                        }
                    },
                    education: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                school: { type: Type.STRING },
                                degree: { type: Type.STRING },
                                location: { type: Type.STRING },
                                startDate: { type: Type.STRING },
                                endDate: { type: Type.STRING },
                                description: { type: Type.STRING }
                            }
                        }
                    },
                    languages: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING }
                    }
                }
            }
        }
    });

    if (!response.text) throw new Error('Empty response from Gemini');
    return parseAiJson(response.text, 'resume parsing');
};

// Parse avec Claude
const parseWithClaude = async (pdfBase64: string): Promise<any> => {
    const cleanBase64 = pdfBase64.replace(/^data:application\/pdf;base64,/, "");

    const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8000,
        messages: [
            {
                role: "user",
                content: [
                    {
                        type: "document",
                        source: {
                            type: "base64",
                            media_type: "application/pdf",
                            data: cleanBase64
                        }
                    },
                    {
                        type: "text",
                        text: RESUME_PARSER_PROMPT
                    }
                ]
            }
        ]
    });

    // Extraire le texte de la réponse
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from Claude');
    }

    // Nettoyer le JSON (enlever les backticks markdown si présents)
    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    return parseAiJson(jsonText, 'resume parsing');
};

const TIMEOUT_MS = 90_000;
// Structured ATS analysis is the heaviest call (large schema, "thinking" models
// reasoning over long job descriptions), so it gets a more generous budget than
// the lighter PDF/job-posting extraction calls. Gemini can also need a second,
// sequential call when the first is cut short by a recitation safety filter (see
// ATS_ANTI_RECITATION_REMINDER), which can roughly double worst-case latency.
const ATS_TIMEOUT_MS = 260_000;

export const withTimeout = <T>(promise: Promise<T>, ms: number = TIMEOUT_MS): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timeout: the request took longer than ${ms / 1000}s`)), ms);
    });
    // If the real request settles after we've already raced it out via the
    // timeout branch, swallow its rejection so it doesn't surface as an
    // unhandled promise rejection in the console.
    promise.catch(() => {});
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// ─── ATS Analysis ────────────────────────────────────────────────────────────

export const serializeCVForATS = (data: CVData): string => {
    const { personalInfo: p, skills, experience, education, languages, currentLanguage } = data;
    const lines: string[] = [];

    lines.push('== PERSONAL INFO ==');
    lines.push(`Name: ${p.firstName} ${p.lastName}`);
    // Show all available language versions of the title so the AI has full context
    for (const code of LANGUAGE_CODES) {
        const val = p.title[code];
        if (val) lines.push(`Title (${code.toUpperCase()}): ${val}`);
    }
    lines.push(`Location: ${p.location}`);
    lines.push(`Email: ${p.email}`);
    if (p.linkedin) lines.push(`LinkedIn: ${p.linkedin}`);
    if (p.github) lines.push(`GitHub: ${p.github}`);
    lines.push(`Summary: ${getLangText(p.summary, currentLanguage)}`);
    const altSummary = LANGUAGE_CODES.filter(c => c !== currentLanguage).map(c => p.summary[c]).find(Boolean);
    if (altSummary) lines.push(`Summary (alt): ${altSummary}`);

    lines.push('\n== SKILLS ==');
    for (const s of skills) {
        lines.push(`[${getLangText(s.name, currentLanguage)}]: ${getLangText(s.items, currentLanguage)}`);
    }

    lines.push('\n== EXPERIENCE ==');
    for (const e of experience) {
        lines.push(`\n${getLangText(e.role, currentLanguage)} at ${e.company} (${e.location})`);
        lines.push(`Period: ${getLangText(e.startDate, currentLanguage)} - ${getLangText(e.endDate, currentLanguage)}`);
        if (e.techStack) lines.push(`Tech: ${e.techStack}`);
        for (const b of getLangArray(e.description, currentLanguage)) lines.push(`  - ${b}`);
    }

    lines.push('\n== EDUCATION ==');
    for (const edu of education) {
        lines.push(`${getLangText(edu.degree, currentLanguage)} — ${edu.school} (${edu.startDate}–${edu.endDate})`);
        const desc = getLangText(edu.description, currentLanguage);
        if (desc) lines.push(`  ${desc}`);
    }

    lines.push('\n== LANGUAGES ==');
    lines.push(getLangArray(languages, currentLanguage).join(', '));

    return lines.join('\n');
};

const ATS_ANALYZER_PROMPT = `You are an expert ATS (Applicant Tracking System) analyst and career coach.
Analyze the CV against the job description and return a JSON object matching this exact schema.

IMPORTANT: Never copy long verbatim passages from the job description into your output
(analysis, issue, summary fields) — paraphrase in your own words. Quoting extended spans
of the job description verbatim can trigger a content-safety cutoff and produce an
incomplete response. Short keyword terms (a few words) and a short verbatim "before"
snippet from the CV are fine.

RULES:
- overallScore: integer 0-100, current match between CV and job description
- estimatedNewScore: integer 0-100, expected score after applying your recommendations
- criticalKeywords: 5-10 non-negotiable keywords from the job (required skills, tools, certs). For each: keyword (exact term from JD), status ("present" if clearly in CV, "partial" if synonym/related found, "missing" if absent), frequency (exact count in CV, 0 if missing), importance: "critical", analysis: a 1-sentence contextual note (e.g. "Present in tools section but overshadowed by TypeScript — move Python earlier" or "Completely absent — critical gap for this role")
- importantKeywords: 5-10 secondary keywords. Same schema, importance: "important", include analysis note for each
- formattingChecks: ATS formatting checks. Cover: contact info completeness, use of action verbs, measurable achievements present, consistent date formats, bullet points usage, no keyword stuffing. status: "pass", "fail", or "warning", include a detail string
- recommendations: 3-6 concrete actionable items. Each: section (e.g. "Summary", "Experience"), issue (the problem), before (SHORT snippet from CV, max ~25 words — not a full paragraph), after (SHORT suggested rewrite, max ~25 words)
- summary: 1-2 sentence plain-text overview of the match quality

Return ONLY valid JSON, no markdown, no code blocks. Exact schema:
{
  "overallScore": number,
  "estimatedNewScore": number,
  "criticalKeywords": [{"keyword": string, "status": "present"|"missing"|"partial", "frequency": number, "importance": "critical", "analysis": string}],
  "importantKeywords": [{"keyword": string, "status": "present"|"missing"|"partial", "frequency": number, "importance": "important", "analysis": string}],
  "formattingChecks": [{"label": string, "status": "pass"|"fail"|"warning", "detail": string}],
  "recommendations": [{"section": string, "issue": string, "before": string, "after": string}],
  "summary": string
}`;

// Claude's max_tokens has no per-model discovery endpoint, so it keeps a conservative
// hardcoded budget — Gemini's real per-model ceiling is looked up instead (see
// geminiMaxOutputTokens above), which is usually several times higher.
const ATS_CLAUDE_MAX_TOKENS = 16000;
const ATS_CLAUDE_RETRY_MAX_TOKENS = 20000;

const ATS_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    properties: {
        overallScore: { type: Type.NUMBER },
        estimatedNewScore: { type: Type.NUMBER },
        criticalKeywords: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    keyword: { type: Type.STRING },
                    status: { type: Type.STRING },
                    frequency: { type: Type.NUMBER },
                    importance: { type: Type.STRING },
                    analysis: { type: Type.STRING }
                },
                required: ['keyword', 'status', 'frequency', 'importance', 'analysis']
            }
        },
        importantKeywords: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    keyword: { type: Type.STRING },
                    status: { type: Type.STRING },
                    frequency: { type: Type.NUMBER },
                    importance: { type: Type.STRING },
                    analysis: { type: Type.STRING }
                },
                required: ['keyword', 'status', 'frequency', 'importance', 'analysis']
            }
        },
        formattingChecks: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    label: { type: Type.STRING },
                    status: { type: Type.STRING },
                    detail: { type: Type.STRING }
                },
                required: ['label', 'status', 'detail']
            }
        },
        recommendations: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    section: { type: Type.STRING },
                    issue: { type: Type.STRING },
                    before: { type: Type.STRING },
                    after: { type: Type.STRING }
                },
                required: ['section', 'issue']
            }
        },
        summary: { type: Type.STRING }
    },
    required: [
        'overallScore', 'estimatedNewScore', 'criticalKeywords',
        'importantKeywords', 'formattingChecks', 'recommendations', 'summary'
    ]
};

// Appended on retry only, after a first attempt got cut short by Gemini's recitation
// safety filter (finishReason "RECITATION") — this happens when the model echoes back
// long verbatim spans of the (often web-published, e.g. LinkedIn) job description, which
// gets flagged as potential content recitation and stops generation mid-output.
const ATS_ANTI_RECITATION_REMINDER = `\n\nREMINDER: Your previous attempt was cut off by a content-safety filter because it quoted too much of the job description verbatim. This time, paraphrase every reference to the job description in your own words — do not copy any phrase longer than a few words directly from it.`;

const analyzeWithGemini = async (cvText: string, jobDescription: string): Promise<any> => {
    const model = await getBestGeminiModel();
    const basePrompt = `${ATS_ANALYZER_PROMPT}\n\n== CV CONTENT ==\n${cvText}\n\n== JOB DESCRIPTION ==\n${jobDescription}`;
    const maxOutputTokens = geminiMaxOutputTokens();

    const callGemini = async (promptText: string) => {
        const response = await geminiAi.models.generateContent({
            model,
            contents: { parts: [{ text: promptText }] },
            config: {
                responseMimeType: "application/json",
                thinkingConfig: thinkingConfigFor(model),
                maxOutputTokens,
                responseSchema: ATS_RESPONSE_SCHEMA
            }
        });
        const finishReason = response.candidates?.[0]?.finishReason;
        console.log('[Gemini ATS]', { model, maxOutputTokens, finishReason, usage: response.usageMetadata });
        return { text: response.text, finishReason };
    };

    let { text, finishReason } = await callGemini(basePrompt);
    if (finishReason === 'RECITATION') {
        // Retrying with the exact same prompt would very likely hit the same wall —
        // the cutoff is about *what* was being generated, not a token budget. A
        // stronger paraphrasing instruction usually avoids it on the second pass.
        ({ text, finishReason } = await callGemini(basePrompt + ATS_ANTI_RECITATION_REMINDER));
    }

    if (finishReason === 'RECITATION') {
        throw new Error("The ATS analysis response was cut short by Gemini's content-safety filter (it detected the output reciting long verbatim passages from the job description) and could not be parsed. This usually happens with job postings copied from public listings — try again, it sometimes succeeds on a retry.");
    }
    if (finishReason === 'SAFETY') {
        throw new Error('The ATS analysis response was blocked by Gemini\'s safety filters and could not be parsed. Try again, or check the job description for content that might trigger this.');
    }
    if (!text) throw new Error('Empty response from Gemini');
    return parseAiJson(text, 'ATS analysis', finishReason === 'MAX_TOKENS');
};

const analyzeWithClaude = async (cvText: string, jobDescription: string): Promise<any> => {
    const prompt = `${ATS_ANALYZER_PROMPT}\n\n== CV CONTENT ==\n${cvText}\n\n== JOB DESCRIPTION ==\n${jobDescription}`;

    const callClaude = async (maxTokens: number) => {
        const response = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: maxTokens,
            messages: [{ role: "user", content: prompt }]
        });

        const textContent = response.content.find(c => c.type === 'text');
        if (!textContent || textContent.type !== 'text') {
            throw new Error('No text response from Claude');
        }

        let jsonText = textContent.text.trim();
        if (jsonText.startsWith('```json')) {
            jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        return { jsonText, truncated: response.stop_reason === 'max_tokens' };
    };

    let { jsonText, truncated } = await callClaude(ATS_CLAUDE_MAX_TOKENS);
    if (truncated) {
        ({ jsonText, truncated } = await callClaude(ATS_CLAUDE_RETRY_MAX_TOKENS));
    }

    return parseAiJson(jsonText, 'ATS analysis', truncated);
};

// Deterministic, offline stand-in for the real LLM analyzers — no network call, same output
// shape, score derived purely from keyword overlap between the job description and the CV
// text. Only reachable when VITE_ATS_PROVIDER=fake exposes it in the UI (see components/
// matches/ProviderPicker usage in JobDetail); keeps e2e scoring scenarios deterministic.
const STOPWORDS = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'for', 'with', 'on', 'is', 'are', 'we', 'you', 'your', 'our', 'this', 'that', 'be', 'as', 'at']);

function extractKeywords(text: string, max: number): string[] {
    const seen = new Map<string, number>();
    for (const word of text.toLowerCase().match(/[a-z][a-z0-9+.#-]{2,}/g) ?? []) {
        if (STOPWORDS.has(word)) continue;
        seen.set(word, (seen.get(word) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([word]) => word);
}

const analyzeWithFake = (cvText: string, jobDescription: string): ATSAnalysisResult => {
    const cvLower = cvText.toLowerCase();
    const jdKeywords = extractKeywords(jobDescription, 10);
    const toEntries = (words: string[], importance: 'critical' | 'important'): ATSKeyword[] =>
        words.map((keyword) => {
            const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const frequency = (cvLower.match(new RegExp(`\\b${escaped}\\b`, 'g')) ?? []).length;
            const status: ATSKeyword['status'] = frequency > 0 ? 'present' : 'missing';
            return {
                keyword,
                status,
                frequency,
                importance,
                analysis: status === 'present' ? `Found ${frequency}x in the CV.` : 'Not found in the CV.',
            };
        });

    const criticalKeywords = toEntries(jdKeywords.slice(0, 5), 'critical');
    const importantKeywords = toEntries(jdKeywords.slice(5, 10), 'important');
    const all = [...criticalKeywords, ...importantKeywords];
    const presentCount = all.filter((k) => k.status === 'present').length;
    const overallScore = all.length > 0 ? Math.round((presentCount / all.length) * 100) : 50;
    const missingCount = all.length - presentCount;

    return {
        overallScore,
        estimatedNewScore: Math.min(100, overallScore + missingCount * 5),
        criticalKeywords,
        importantKeywords,
        formattingChecks: [
            { label: 'Fake provider', status: 'pass', detail: 'No LLM call was made — score derived from keyword overlap only.' },
        ],
        recommendations: all
            .filter((k) => k.status === 'missing')
            .map((k) => ({ section: 'Skills', issue: `"${k.keyword}" is missing from the CV.` })),
        summary: `Deterministic fake analysis: ${presentCount}/${all.length} keywords found.`,
    };
};

export const analyzeATS = async (
    cvData: CVData,
    jobDescription: string,
    provider: AIProvider = 'gemini'
): Promise<ATSAnalysisResult> => {
    const cvText = serializeCVForATS(cvData);
    if (provider === 'fake') return analyzeWithFake(cvText, jobDescription);
    return withTimeout(
        provider === 'claude'
            ? analyzeWithClaude(cvText, jobDescription)
            : analyzeWithGemini(cvText, jobDescription),
        ATS_TIMEOUT_MS
    ) as Promise<ATSAnalysisResult>;
};

// ─── PDF Parsing ──────────────────────────────────────────────────────────────

// Fonction principale avec sélection du provider
export const parseResumeFromPdf = async (
    pdfBase64: string,
    provider: AIProvider = 'gemini',
    onProgress?: (step: 'sending' | 'processing') => void
): Promise<CVData> => {

    onProgress?.('sending');
    const extracted = await withTimeout(
        provider === 'claude'
            ? parseWithClaude(pdfBase64)
            : parseWithGemini(pdfBase64)
    );
    onProgress?.('processing');

    // Helper to create bilingual string from one
    const toBilingual = (str: string): { fr: string, en: string } => ({ fr: str || "", en: str || "" });
    const toBilingualArray = (arr: string[]): { fr: string[], en: string[] } => ({ fr: arr || [], en: arr || [] });

    // Post-process to add IDs and ensure structure matches CVData interface
    return {
        currentLanguage: 'fr',
        personalInfo: {
            firstName: extracted.personalInfo?.firstName || "",
            lastName: extracted.personalInfo?.lastName || "",
            title: toBilingual(extracted.personalInfo?.title),
            email: extracted.personalInfo?.email || "",
            medium: extracted.personalInfo?.medium || "",
            location: extracted.personalInfo?.location || "",
            linkedin: extracted.personalInfo?.linkedin || "",
            github: extracted.personalInfo?.github || "",
            summary: toBilingual(extracted.personalInfo?.summary),
            photo: null
        },
        skills: (extracted.skills || []).map((s: any) => ({
            id: crypto.randomUUID(),
            name: toBilingual(s.name || "Compétences"),
            items: toBilingual(s.items || "")
        })),
        experience: (extracted.experience || []).map((e: any) => ({
            id: crypto.randomUUID(),
            role: toBilingual(e.role || ""),
            company: e.company || "",
            location: e.location || "",
            startDate: toBilingual(e.startDate || ""),
            endDate: toBilingual(e.endDate || ""),
            description: toBilingualArray(Array.isArray(e.description) ? e.description : []),
            techStack: e.techStack || ""
        })),
        education: (extracted.education || []).map((e: any) => ({
            id: crypto.randomUUID(),
            school: e.school || "",
            degree: toBilingual(e.degree || ""),
            location: e.location || "",
            startDate: e.startDate || "",
            endDate: e.endDate || "",
            description: toBilingual(e.description || "")
        })),
        certifications: [],
        languages: toBilingualArray(Array.isArray(extracted.languages) ? extracted.languages : [])
    };
};

// ─── Job Posting Extraction ────────────────────────────────────────────────────

export interface ExtractedJobFields {
    company: string;
    title: string;
    location: string;
    workMode: JobWorkMode | '';
    contractType: JobContractType | '';
    salaryRange: string;
    keywords: string[];
}

const JOB_EXTRACTOR_PROMPT = `You are an expert at parsing job postings. Extract structured fields from the raw job posting text below.

RULES:
- "company": ONLY the hiring company's name, else empty string
- "title": ONLY the job title, else empty string
- "location": city/country if mentioned, else empty string
- "workMode": "onsite", "hybrid" or "remote" only if explicitly stated, else empty string
- "contractType": "CDI", "CDD", "freelance" or "internship" only if explicitly stated, else empty string
- "salaryRange": salary/compensation range if mentioned, else empty string
- "keywords": 5-10 distinct technical skills, tools or requirements mentioned

Return ONLY valid JSON, no markdown, no code blocks. Exact schema:
{"company": string, "title": string, "location": string, "workMode": string, "contractType": string, "salaryRange": string, "keywords": string[]}`;

const extractJobWithGemini = async (rawText: string): Promise<any> => {
    const model = await getBestGeminiModel();
    const response = await geminiAi.models.generateContent({
        model,
        contents: { parts: [{ text: `${JOB_EXTRACTOR_PROMPT}\n\n== JOB POSTING ==\n${rawText}` }] },
        config: {
            responseMimeType: "application/json",
            thinkingConfig: thinkingConfigFor(model),
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    company: { type: Type.STRING },
                    title: { type: Type.STRING },
                    location: { type: Type.STRING },
                    workMode: { type: Type.STRING },
                    contractType: { type: Type.STRING },
                    salaryRange: { type: Type.STRING },
                    keywords: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
            },
        },
    });
    if (!response.text) throw new Error('Empty response from Gemini');
    return parseAiJson(response.text, 'job posting extraction');
};

const extractJobWithClaude = async (rawText: string): Promise<any> => {
    const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: `${JOB_EXTRACTOR_PROMPT}\n\n== JOB POSTING ==\n${rawText}` }],
    });
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
        throw new Error('No text response from Claude');
    }
    let jsonText = textContent.text.trim();
    if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return parseAiJson(jsonText, 'job posting extraction');
};

const WORK_MODE_HINTS: [RegExp, JobWorkMode][] = [[/remote/i, 'remote'], [/hybrid/i, 'hybrid'], [/on-?site/i, 'onsite']];
const CONTRACT_HINTS: [RegExp, JobContractType][] = [[/\bCDI\b/i, 'CDI'], [/\bCDD\b/i, 'CDD'], [/freelance/i, 'freelance'], [/internship/i, 'internship']];

// Deterministic, offline stand-in: reads simple "Key: value" lines when present (as a
// crafted test fixture would use), otherwise falls back to the first two non-empty lines
// for title/company and keyword-frequency extraction for the rest — no LLM call.
const extractJobFake = (rawText: string): ExtractedJobFields => {
    const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean);
    const findField = (label: string) => {
        const line = lines.find((l) => new RegExp(`^${label}\\s*:`, 'i').test(l));
        return line ? line.split(':').slice(1).join(':').trim() : '';
    };

    const title = findField('title') || lines[0] || '';
    const company = findField('company') || lines[1] || '';
    const location = findField('location');
    const salaryRange = findField('salary');

    const workMode = WORK_MODE_HINTS.find(([re]) => re.test(rawText))?.[1] ?? '';
    const contractType = CONTRACT_HINTS.find(([re]) => re.test(rawText))?.[1] ?? '';
    const keywords = extractKeywords(rawText, 8);

    return { company, title, location, workMode, contractType, salaryRange, keywords };
};

export const extractJobFromText = async (
    rawText: string,
    provider: AIProvider = 'gemini'
): Promise<ExtractedJobFields> => {
    if (provider === 'fake') return extractJobFake(rawText);
    const extracted = await withTimeout(
        provider === 'claude' ? extractJobWithClaude(rawText) : extractJobWithGemini(rawText)
    );
    return {
        company: extracted.company || '',
        title: extracted.title || '',
        location: extracted.location || '',
        workMode: (['onsite', 'hybrid', 'remote'] as const).includes(extracted.workMode) ? extracted.workMode : '',
        contractType: (['CDI', 'CDD', 'freelance', 'internship'] as const).includes(extracted.contractType) ? extracted.contractType : '',
        salaryRange: extracted.salaryRange || '',
        keywords: Array.isArray(extracted.keywords) ? extracted.keywords : [],
    };
};

// Job-search keyword expansion and candidate qualification now run server-side via
// the `claude` CLI — see server/scrapers/claudeCli.js (expandKeywords/qualifyAll),
// server/routes.scraper.js (POST /expand-keywords, POST /qualify), and
// services/scraperService.ts (expandSearchKeywords/qualifyScrapedJobs), which is what
// pages/JobSearchPage.tsx calls. They used to live here as direct Gemini/Claude API
// calls; moved to avoid a separate billed API key/rate limit for what's otherwise the
// same CLI mechanism the claude_cli search portal already uses.
