#!/usr/bin/env python3
"""Generate WebTNT's original promo-derived sound effects, without music.

Development-only dependency: NumPy (python -m pip install numpy).
Run from any directory: python tools/generate_audio.py
The extension plays the checked-in WAVs and needs no Python or NumPy.

The original promo used the same synthesis below. Its first FX event can be
recreated exactly from the saved PCG64 state, without generating its background
score. Asset finishing adds small click-safe fades, a crossfaded fuse loop, and
silence after the restore chime. All sounds are original and MIT licensed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import wave

try:
    import numpy as np
except ImportError as exc:
    raise SystemExit("Audio generation requires NumPy: python -m pip install numpy") from exc


SR = 48_000
TAU = 2 * np.pi
# Original promo: seed 20261013, 20.15 s, 106 BPM. This is the PRNG state
# immediately before the first FX event; no score is generated or included.
PROMO_FX_STATE = {
    "bit_generator": "PCG64",
    "state": {
        "state": 243187924863915549168735747069590538487,
        "inc": 253412227998590632148076786661514803727,
    },
    "has_uint32": 0,
    "uinteger": 0,
}
PROMO_DROP = 2.85
PROMO_BLAST = 3.7447
PROMO_RESTORE = 5.945
PROMO_PAN = -0.3


def add(track: np.ndarray, sound: np.ndarray, at: float, gain: float = 1.0,
        pan: float = 0.0) -> None:
    """Mix mono into stereo with the original constant-power panning."""
    start = int(round(at * SR))
    end = start + len(sound)
    source_start = max(0, -start)
    source_end = len(sound) - max(0, end - len(track))
    if source_end <= source_start:
        return
    destination = slice(max(0, start), min(len(track), end))
    angle = (np.clip(pan, -1, 1) + 1) * np.pi / 4
    source = sound[source_start:source_end] * gain
    track[destination, 0] += source * np.cos(angle)
    track[destination, 1] += source * np.sin(angle)


def noise(duration: float, rng: np.random.Generator, low_hz: float = 100,
          high_hz: float = 16_000, slope: float = 0.0) -> np.ndarray:
    size = max(2, round(duration * SR))
    source = rng.normal(0, 1, size)
    frequency = np.fft.rfftfreq(size, 1 / SR)
    spectrum = np.fft.rfft(source)
    response = np.minimum(1, (frequency / max(1, low_hz)) ** 2)
    response *= 1 / (1 + (frequency / high_hz) ** 8)
    response[0] = 0
    if slope:
        response *= np.maximum(frequency, 80) ** slope
    result = np.fft.irfft(spectrum * response, n=size)
    result /= max(1e-6, np.std(result))
    return result


def click(rng: np.random.Generator) -> np.ndarray:
    time = np.arange(round(.045 * SR)) / SR
    return (.27 * np.sin(TAU * 1_400 * time) * np.exp(-time * 180)
            + .16 * rng.normal(size=len(time)) * np.exp(-time * 210))


def fuse(track: np.ndarray, drop: float, blast_at: float,
         rng: np.random.Generator, pan: float) -> None:
    add(track, click(rng), drop, pan=pan)
    start = drop + .045
    length = max(.1, blast_at - start)
    time = np.arange(round(length * SR)) / SR
    hiss = noise(length, rng, 3_300, 13_000)
    progress = np.clip(time / length, 0, 1)
    hiss *= (.024 + .052 * progress) * (.72 + .28 * np.sin(TAU * 28 * time) ** 2)
    hiss *= np.minimum(1, time / .03) * np.minimum(1, (length - time) / .025)
    add(track, hiss, start, pan=pan * .4)
    for spark_at in np.arange(start + .12, blast_at - .025, .14):
        add(track, click(rng) * .18, spark_at,
            pan=np.clip(pan + rng.uniform(-.5, .5), -1, 1))


def blast(track: np.ndarray, at: float, rng: np.random.Generator,
          pan: float) -> None:
    time = np.arange(round(1.3 * SR)) / SR
    frequency = 41 + 96 * np.exp(-time * 14)
    low = np.sin(TAU * np.cumsum(frequency) / SR)
    low *= np.exp(-time * 5.8) * (1 - np.exp(-time * 1900)) * .67
    body = noise(1.3, rng, 75, 5_500, slope=-.55)
    body *= np.exp(-time * 7.6) * (1 - np.exp(-time * 1300)) * .12
    crack = noise(1.3, rng, 1_300, 13_000)
    crack *= np.exp(-time * 44) * .1
    add(track, low + body + crack, at, pan=pan * .2)
    for _ in range(19):
        delay = .03 + rng.exponential(.19)
        length = rng.uniform(.025, .1)
        time = np.arange(round(length * SR)) / SR
        frequency = rng.uniform(1_250, 5_600)
        shard = np.sin(TAU * frequency * time) * np.exp(-time * rng.uniform(50, 110))
        shard += noise(length, rng, 1_800, 14_000) * np.exp(-time * 75) * .55
        shard *= rng.uniform(.013, .038) * (1 - np.exp(-time * 1800))
        add(track, shard, at + delay, pan=rng.uniform(-.85, .85))


def tone(note: float, duration: float, gain: float) -> np.ndarray:
    time = np.arange(round(duration * SR)) / SR
    frequency = 440 * 2 ** ((note - 69) / 12)
    envelope = (1 - np.exp(-time * 300)) * np.exp(-time * 5.6)
    signal = (np.sin(TAU * frequency * time)
              + .23 * np.sin(TAU * frequency * 2 * time)
              + .08 * np.sin(TAU * frequency * 3 * time))
    return signal * envelope * gain


def restore(track: np.ndarray, at: float, rng: np.random.Generator,
            pan: float) -> None:
    length = .38
    time = np.arange(round(length * SR)) / SR
    progress = time / length
    frequency = 180 * (12 ** progress)
    envelope = np.sin(np.pi * np.clip(progress, 0, 1)) ** 1.4
    swoop = np.sin(TAU * np.cumsum(frequency) / SR) * .056
    airy = noise(length, rng, 600, 8_000) * .04
    add(track, (swoop + airy) * envelope, at - .04, pan=-pan * .3)
    for delay in (.025, .12, .18, .225, .26, .287):
        add(track, click(rng), at + delay, gain=.13, pan=rng.uniform(-.5, .5))
    add(track, tone(86, .3, .047), at + .31, pan=.25)
    add(track, tone(74, .24, .025), at + .31, pan=-.25)


def first_event() -> np.ndarray:
    """Recreate the first isolated FX event; output matches the original stem."""
    rng = np.random.Generator(np.random.PCG64())
    rng.bit_generator.state = PROMO_FX_STATE
    track = np.zeros((round(7 * SR), 2), dtype=np.float64)
    fuse(track, PROMO_DROP, PROMO_BLAST, rng, PROMO_PAN)
    blast(track, PROMO_BLAST, rng, PROMO_PAN)
    restore(track, PROMO_RESTORE, rng, PROMO_PAN)
    return track


def fade_edges(samples: np.ndarray, attack: float, release: float) -> np.ndarray:
    result = samples.copy()
    for seconds, leading in ((attack, True), (release, False)):
        frames = min(len(result), round(seconds * SR))
        if frames > 1:
            ramp = np.linspace(0, 1, frames) ** 2
            if leading:
                result[:frames] *= ramp[:, None]
            else:
                result[-frames:] *= ramp[::-1, None]
    return result


def fuse_loop(samples: np.ndarray, overlap_seconds: float = .06) -> np.ndarray:
    """Join tail to head; the file boundary remains adjacent source samples.

    Loop body starts after the first overlap. An equal-power crossfade follows
    the middle body and connects the original tail back into its original head.
    The last and first frames are original consecutive samples, so looping does
    not add a synthetic discontinuity or repeat the separate ignition click.
    """
    overlap = round(overlap_seconds * SR)
    if len(samples) <= overlap * 2:
        raise ValueError("Fuse source is too short for the requested loop crossfade")
    phase = np.linspace(0, np.pi / 2, overlap)
    seam = (samples[-overlap:] * np.cos(phase)[:, None]
            + samples[:overlap] * np.sin(phase)[:, None])
    return np.concatenate((samples[overlap:-overlap], seam))


def write_wav(path: Path, samples: np.ndarray) -> dict:
    peak = float(np.max(np.abs(samples)))
    if not np.all(np.isfinite(samples)) or peak >= .85:
        raise ValueError(f"Invalid or insufficient-headroom audio: {path.name}, peak {peak}")
    pcm = np.rint(samples * 32767).astype('<i2')
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SR)
        handle.writeframes(pcm.tobytes())
    quantized = pcm.astype(np.float64) / 32768
    peak = float(np.max(np.abs(quantized)))
    rms = float(np.sqrt(np.mean(quantized ** 2)))
    return {
        'file': path.name,
        'duration_seconds': round(len(pcm) / SR, 6),
        'sample_peak_dbfs': round(20 * math.log10(max(peak, 1e-12)), 3),
        'rms_dbfs': round(20 * math.log10(max(rms, 1e-12)), 3),
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def generate(output: Path) -> dict:
    event = first_event()
    drop = round(PROMO_DROP * SR)
    ignition_end = drop + round(.045 * SR)
    blast_at = round(PROMO_BLAST * SR)
    restore_at = round((PROMO_RESTORE - .04) * SR)
    # Each effect is a sample-exact slice of the original FX stem before its
    # documented asset finishing below. There is no music in any slice.
    ignition = fade_edges(event[drop:ignition_end], .0005, .005)
    burning = fuse_loop(event[ignition_end:blast_at])
    impact = fade_edges(event[blast_at:blast_at + round(1.3 * SR)], .0005, .035)
    returning = fade_edges(event[restore_at:restore_at + round(.65 * SR)], 0, .045)
    returning = np.pad(returning, ((0, round(.025 * SR)), (0, 0)))
    assets = [('ignite.wav', ignition), ('fuse.wav', burning),
              ('blast.wav', impact), ('restore.wav', returning)]
    files = [write_wav(output / name, samples) for name, samples in assets]
    report = {
        'format': 'WAV / stereo PCM16 / 48000 Hz',
        'license': 'MIT; see the repository LICENSE',
        'copyright': 'Copyright (c) 2026 TNT Blast contributors',
        'source': 'Original WebTNT promotional film sound effects; procedural synthesis; no external audio or music',
        'promo_event_seconds': {'drop': PROMO_DROP, 'blast': PROMO_BLAST, 'restore': PROMO_RESTORE},
        'original_seed': 20261013,
        'generator': 'tools/generate_audio.py',
        'finishing': {
            'ignite.wav': '0.5 ms attack and 5 ms release fade',
            'fuse.wav': 'Separate ignition removed; 60 ms equal-power loop crossfade; no silence padding',
            'blast.wav': '0.5 ms attack and 35 ms release fade; original asymmetric debris preserved',
            'restore.wav': 'Includes original 40 ms lead-in swoop; 45 ms tail fade; 25 ms terminal silence',
        },
        'loopable': ['fuse.wav'],
        'files': files,
    }
    (output / 'audio-manifest.json').write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path,
                        default=Path(__file__).resolve().parents[1] / 'extension' / 'assets' / 'audio')
    args = parser.parse_args()
    report = generate(args.output)
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
