// loudness.mjs: the parsers on ffmpeg's real output shapes, and one real
// two-pass normalisation of a quiet tone (real ffmpeg: a mocked encoder
// would not show that the measured values reach the second pass).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { measureLufs, normalise, parseIntegratedLufs, parseLoudnormJson, secondPassFilter } from './loudness.mjs';
import { probe } from './stage-io.mjs';

let tmp;
afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = undefined;
});

const LOUDNORM_STDERR = `[Parsed_loudnorm_0 @ 0x1] \n{\n\t"input_i" : "-32.40",\n\t"input_tp" : "-14.02",\n\t"input_lra" : "3.10",\n\t"input_thresh" : "-42.61",\n\t"output_i" : "-16.20",\n\t"output_tp" : "-1.00",\n\t"output_lra" : "2.90",\n\t"output_thresh" : "-26.40",\n\t"normalization_type" : "dynamic",\n\t"target_offset" : "0.20"\n}\n[out#0/null @ 0x2] video:41KiB audio:1506KiB\n`;

describe('parseLoudnormJson', () => {
  it('reads the measured values pass 2 needs', () => {
    /** Pass 2 is only linear when it is fed pass 1's exact measurement. */
    // GIVEN — loudnorm's json block as ffmpeg prints it
    // WHEN
    const m = parseLoudnormJson(LOUDNORM_STDERR);
    // THEN
    expect(m).toEqual({ input_i: -32.4, input_tp: -14.02, input_lra: 3.1, input_thresh: -42.61, target_offset: 0.2 });
  });

  it('throws on silent audio, where loudnorm reports -inf', () => {
    /** A silent cut must fail the stage, not pass "-inf" into pass 2. */
    // GIVEN
    const silent = LOUDNORM_STDERR.replace('"-32.40"', '"-inf"');
    // WHEN / THEN
    expect(() => parseLoudnormJson(silent)).toThrow(/input_i/);
  });
});

describe('secondPassFilter', () => {
  it('targets -16 LUFS, -1 dBTP, LRA 11 with the measured values, linearly', () => {
    /** The bead's recipe: I=-16:TP=-1:LRA=11, two-pass. */
    // GIVEN / WHEN
    const f = secondPassFilter({ input_i: -32.4, input_tp: -14.02, input_lra: 3.1, input_thresh: -42.61, target_offset: 0.2 });
    // THEN
    expect(f).toBe('loudnorm=I=-16:TP=-1:LRA=11:measured_I=-32.4:measured_TP=-14.02:measured_LRA=3.1:measured_thresh=-42.61:offset=0.2:linear=true:print_format=summary');
  });
});

describe('parseIntegratedLufs', () => {
  it('takes the summary value, not a running one', () => {
    /** verify.mjs reads the LAST "I: ... LUFS"; this stage must judge the same number. */
    // GIVEN — two running lines then the summary
    const err = 'I: -40.0 LUFS\nI: -30.0 LUFS\n  Integrated loudness:\n    I:         -16.1 LUFS\n';
    // WHEN / THEN
    expect(parseIntegratedLufs(err)).toBe(-16.1);
  });
});

describe('normalise (real ffmpeg)', () => {
  it('brings a quiet clip into the eval window, copies the video and writes AAC 48 kHz stereo', () => {
    /**
     * The proof render measured -32.4 LUFS, far below the eval's -20..-12.
     * This runs the whole two-pass path on a real quiet clip.
     */
    // GIVEN — a 4 s clip with a quiet 440 Hz tone and a video stream
    tmp = mkdtempSync(join(tmpdir(), 'loudness-test-'));
    const f = join(tmp, 'clip.mp4');
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=gray:s=64x64:d=4:r=25', '-f', 'lavfi', '-i', 'sine=f=440:d=4:sample_rate=44100', '-filter:a', 'volume=0.05', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', f]);
    const before = measureLufs(f);
    // WHEN
    const r = normalise(f);
    // THEN
    expect(before).toBeLessThan(-25);
    expect(r.after).toBeGreaterThanOrEqual(-18);
    expect(r.after).toBeLessThanOrEqual(-14);
    const a = probe(f).streams.find((s) => s.codec_type === 'audio');
    const v = probe(f).streams.find((s) => s.codec_type === 'video');
    expect([a.codec_name, a.sample_rate, a.channels]).toEqual(['aac', '48000', 2]);
    expect(v.codec_name).toBe('h264');
  });
});
