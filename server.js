import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureDir } from './server/store.js';
import { migrateLegacyCvs, migrateScraperCandidatesToSqlite } from './server/migrate.js';
import { registerTestHooks } from './server/testHooks.js';
import { createCvsRouter } from './server/routes.cvs.js';
import { createJobsRouter } from './server/routes.jobs.js';
import { createCompaniesRouter } from './server/routes.companies.js';
import { createPreferencesRouter } from './server/routes.preferences.js';
import { createScraperRouter } from './server/routes.scraper.js';
import { createTemplateSettingsRouter } from './server/routes.templateSettings.js';
import { openTemplateSettingsDb } from './server/templateSettingsStore.js';

const app = express();
const PORT = 3001;

// Allow all origins for local network multi-device access
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const YARB_DATA_DIR = path.resolve(process.env.YARB_DATA_DIR ?? './data');
const LEGACY_CV_STORAGE_DIR = path.join(process.cwd(), 'cvs');
const CV_STORAGE_DIR = path.join(YARB_DATA_DIR, 'cvs');
const JOBS_STORAGE_DIR = path.join(YARB_DATA_DIR, 'jobs');
const COMPANIES_STORAGE_DIR = path.join(YARB_DATA_DIR, 'companies');
const PREFERENCES_STORAGE_FILE = path.join(YARB_DATA_DIR, 'preferences.json');
// Scraper candidates moved off flat JSON files to SQLite (unlike cvs/jobs/companies,
// this collection has no retention policy and grows unbounded with every scrape run —
// see server/scraperCandidatesStore.js). SCRAPER_CANDIDATES_LEGACY_DIR is now only a
// read-only migration source, never written to again.
const SCRAPER_CANDIDATES_DB_PATH = path.join(YARB_DATA_DIR, 'scraper-candidates.sqlite');
const SCRAPER_CANDIDATES_LEGACY_DIR = path.join(YARB_DATA_DIR, 'scraper-candidates');
const TEMPLATE_SETTINGS_DB_PATH = path.join(YARB_DATA_DIR, 'template-settings.sqlite');

ensureDir(CV_STORAGE_DIR);
ensureDir(JOBS_STORAGE_DIR);
ensureDir(COMPANIES_STORAGE_DIR);
await migrateLegacyCvs({ legacyDir: LEGACY_CV_STORAGE_DIR, dataDir: YARB_DATA_DIR });
const { db: candidatesDb } = await migrateScraperCandidatesToSqlite({
    legacyDir: SCRAPER_CANDIDATES_LEGACY_DIR,
    dbPath: SCRAPER_CANDIDATES_DB_PATH,
});
const templateSettingsDb = openTemplateSettingsDb(TEMPLATE_SETTINGS_DB_PATH);

const compileLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    message: { error: 'Too many compilation requests, please wait a minute.' },
});
app.use('/compile', compileLimiter);

// Endpoint pour compiler du LaTeX en PDF
app.post('/compile', async (req, res) => {
    const { latex: latexCode, photoData } = req.body;

    if (!latexCode) {
        return res.status(400).json({ error: 'No LaTeX code provided' });
    }

    // Créer un dossier temporaire
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-'));
    const texFile = path.join(tempDir, 'document.tex');
    const pdfFile = path.join(tempDir, 'document.pdf');

    try {
        // Écrire le fichier .tex
        fs.writeFileSync(texFile, latexCode);

        // Si une photo est fournie, l'écrire dans le dossier temporaire
        if (photoData && photoData.data && photoData.extension) {
            const photoFile = path.join(tempDir, `photo.${photoData.extension}`);
            const photoBuffer = Buffer.from(photoData.data, 'base64');
            fs.writeFileSync(photoFile, photoBuffer);
            console.log(`Photo saved: ${photoFile} (${photoBuffer.length} bytes)`);
        }

        // Compiler avec pdflatex (2 passes pour les références)
        await new Promise((resolve, reject) => {
            const pdflatexPath = process.env.PDFLATEX_PATH ?? '/Library/TeX/texbin/pdflatex';
            const command = `cd "${tempDir}" && "${pdflatexPath}" -interaction=nonstopmode "document.tex"`;

            exec(command, { timeout: 60000 }, (error, stdout, stderr) => {
                // pdflatex retourne souvent un code d'erreur même pour des warnings
                // On vérifie si le PDF a été généré
                if (fs.existsSync(pdfFile)) {
                    resolve(stdout);
                } else {
                    reject(new Error(`Compilation failed:\n${stdout}\n${stderr}`));
                }
            });
        });

        // Lire le PDF généré
        const pdfBuffer = fs.readFileSync(pdfFile);

        // Nettoyer les fichiers temporaires
        fs.rmSync(tempDir, { recursive: true, force: true });

        // Renvoyer le PDF
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="cv.pdf"');
        res.send(pdfBuffer);

    } catch (error) {
        // Nettoyer en cas d'erreur
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch { }

        console.error('Compilation error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// CVthèque / Jobs API
app.use('/api/cvs', createCvsRouter({ cvsDir: CV_STORAGE_DIR, jobsDir: JOBS_STORAGE_DIR }));
app.use('/api/jobs', createJobsRouter({ jobsDir: JOBS_STORAGE_DIR, cvsDir: CV_STORAGE_DIR }));
app.use('/api/companies', createCompaniesRouter({ companiesDir: COMPANIES_STORAGE_DIR, jobsDir: JOBS_STORAGE_DIR }));
app.use('/api/preferences', createPreferencesRouter({ preferencesFilePath: PREFERENCES_STORAGE_FILE, cvsDir: CV_STORAGE_DIR }));
app.use(
    '/api/scraper',
    createScraperRouter({
        candidatesDb,
        jobsDir: JOBS_STORAGE_DIR,
        preferencesFilePath: PREFERENCES_STORAGE_FILE,
    })
);
app.use('/api/template-settings', createTemplateSettingsRouter({ db: templateSettingsDb }));

registerTestHooks(app, { dataDir: YARB_DATA_DIR, candidatesDb });

export { app };

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        console.log(`LaTeX compilation server running on http://localhost:${PORT}`);
    });
}
