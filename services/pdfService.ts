/**
 * Service pour compiler du code LaTeX en PDF via le serveur local
 */
import { API_PORT } from './apiClient';

export interface PhotoData {
    data: string;       // Données base64
    extension: string;  // 'jpg' ou 'png'
}

export interface CompileRequest {
    latex: string;
    photoData?: PhotoData | null;
}

export const compileToPdf = async (latexCode: string, photoData?: PhotoData | null): Promise<Blob> => {
    const requestBody: CompileRequest = {
        latex: latexCode,
        photoData: photoData || null
    };

    const response = await fetch(`http://localhost:${API_PORT}/compile`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Erreur de compilation LaTeX: ${response.status} - ${errorText}`);
    }

    return response.blob();
};

/**
 * Télécharge un Blob en tant que fichier
 */
export const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
