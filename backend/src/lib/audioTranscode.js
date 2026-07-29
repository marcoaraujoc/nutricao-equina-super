'use strict';

// Conversão de áudio para MP3 via ffmpeg estático (@ffmpeg-installer).
// Motivo: notas de voz (WhatsApp = Ogg/Opus) e gravações do app (WebM/Opus)
// NÃO tocam no Safari/iOS. MP3 reproduz em todos os navegadores e continua
// aceito pelo Gemini na transcrição. Usado no upload de mídias de evolução.

const { spawn } = require('child_process');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

// Extensões que o Safari/iOS não reproduz — candidatas à conversão.
const EXTS_INCOMPATIVEIS_SAFARI = new Set(['.ogg', '.oga', '.opus', '.webm']);

/**
 * Converte um arquivo de áudio para MP3 (VBR ~140kbps — suficiente para voz).
 * Resolve quando o arquivo de saída está pronto; rejeita em falha do ffmpeg.
 */
function transcodeParaMp3(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      ffmpegPath,
      ['-y', '-i', inputPath, '-vn', '-codec:a', 'libmp3lame', '-qscale:a', '4', outputPath],
      { windowsHide: true },
    );
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(-400)}`));
    });
  });
}

module.exports = { transcodeParaMp3, EXTS_INCOMPATIVEIS_SAFARI };
