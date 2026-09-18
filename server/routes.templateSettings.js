import express from 'express';
import { getTemplateSettings, updateTemplateSettings } from './templateSettingsStore.js';

function errorBody(code, message) {
    return { error: { code, message } };
}

// Singleton (like preferences.json's route): the row always "exists" conceptually,
// seeded by templateSettingsStore.ensureSchema, so there's no POST/DELETE — only
// GET/PUT.
export function createTemplateSettingsRouter({ db }) {
    const router = express.Router();

    router.get('/', (req, res) => {
        res.json(getTemplateSettings(db));
    });

    router.put('/', (req, res) => {
        const { fontId } = req.body ?? {};
        if (typeof fontId !== 'string' || fontId.trim().length === 0) {
            return res.status(400).json(errorBody('invalid_font_id', 'fontId must be a non-empty string'));
        }

        res.json(updateTemplateSettings(db, { fontId }));
    });

    return router;
}
