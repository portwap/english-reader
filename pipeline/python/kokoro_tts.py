"""Kokoro text-to-speech: turns English text into a WAV file and word timings.

The only Python in the project. Called by pipeline/tts/kokoro.ts, which does the rest (mp3, checks).

Usage: python kokoro_tts.py --voice af_heart --text in.txt --wav out.wav --words out.json
"""

import argparse
import json
import wave

import numpy as np
from kokoro import KPipeline

SAMPLE_RATE = 24000  # Kokoro always outputs 24 kHz mono audio.
REPO_ID = "hexgrad/Kokoro-82M"


def synthesize(text: str, voice: str) -> tuple[np.ndarray, list[dict]]:
    """Voice the text with one Kokoro voice.

    Takes the text and a voice id such as "af_heart".
    Returns the audio as float samples (-1..1) and the spoken words,
    each with start and end in seconds from the start of the audio.
    """
    # The first letter of a voice id is its accent: "a" American, "b" British.
    pipeline = KPipeline(lang_code=voice[0], repo_id=REPO_ID)
    chunks: list[np.ndarray] = []
    words: list[dict] = []
    offset = 0.0
    for result in pipeline(text, voice=voice):
        if result.audio is None:
            continue
        audio = result.audio.numpy()
        # Kokoro times each chunk from zero, so shift by the audio that came before it.
        for token in result.tokens or []:
            if token.start_ts is None or token.end_ts is None:
                continue
            # Punctuation gets a timing too, but it is not a word you can hear.
            if not any(ch.isalnum() for ch in token.text):
                continue
            words.append({
                "text": token.text,
                "start": round(offset + token.start_ts, 3),
                "end": round(offset + token.end_ts, 3),
            })
        chunks.append(audio)
        offset += len(audio) / SAMPLE_RATE
    if not chunks:
        raise SystemExit("Kokoro produced no audio for this text.")
    return np.concatenate(chunks), words


def write_wav(path: str, audio: np.ndarray) -> None:
    """Write float samples (-1..1) to a 16-bit mono WAV file."""
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2")
    with wave.open(path, "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SAMPLE_RATE)
        f.writeframes(pcm.tobytes())


def main() -> None:
    """Read the arguments, voice the text, write the WAV and the timings JSON."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice", required=True)
    parser.add_argument("--text", required=True, help="UTF-8 text file to voice")
    parser.add_argument("--wav", required=True, help="output WAV file")
    parser.add_argument("--words", required=True, help="output JSON: duration and words")
    args = parser.parse_args()

    with open(args.text, encoding="utf-8") as f:
        text = f.read()
    audio, words = synthesize(text, args.voice)
    write_wav(args.wav, audio)
    with open(args.words, "w", encoding="utf-8") as f:
        json.dump({"duration": len(audio) / SAMPLE_RATE, "words": words}, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
