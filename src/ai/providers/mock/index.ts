import crypto from 'node:crypto';
import sharp from 'sharp';
import type { GeneratedImage, ImageProvider, ImageRefineRequest, ImageRequest, TextProvider, TextRequest, TextResult } from '../types.js';
import { THUMBNAIL_STRATEGIES } from '../../../types/index.js';

/**
 * TEST_MODE providers (section 51).
 * They exercise the complete technical pipeline — parsing, JSON handling,
 * image bytes, overlay, validation, export — without spending API money.
 */

function seedFrom(text: string): number {
  return parseInt(crypto.createHash('sha1').update(text).digest('hex').slice(0, 8), 16);
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Renders a deterministic, visually distinct placeholder artwork. */
export class MockImageProvider implements ImageProvider {
  readonly id = 'mock';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async supportsModel(): Promise<boolean> {
    return true;
  }

  async refine(req: ImageRefineRequest): Promise<GeneratedImage> {
    const [img] = await this.generate({ ...req, prompt: `${req.prompt}::refined`, n: 1 });
    return img;
  }

  async generate(req: ImageRequest): Promise<GeneratedImage[]> {
    const started = Date.now();
    const [w, h] = req.size.includes('x') ? req.size.split('x').map(Number) : [2560, 1440];
    const width = w || 2560;
    const height = h || 1440;
    const n = req.n ?? 1;
    const out: GeneratedImage[] = [];

    for (let i = 0; i < n; i++) {
      const rnd = mulberry(seedFrom(req.prompt + i));
      const hue = Math.floor(rnd() * 360);
      const hue2 = (hue + 140 + Math.floor(rnd() * 80)) % 360;
      const cx = 0.25 + rnd() * 0.5;
      const cy = 0.35 + rnd() * 0.3;
      const r = 0.15 + rnd() * 0.18;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <radialGradient id="bg" cx="${(cx * 100).toFixed(1)}%" cy="${(cy * 100).toFixed(1)}%" r="85%">
      <stop offset="0%" stop-color="hsl(${hue},65%,38%)"/>
      <stop offset="60%" stop-color="hsl(${hue},55%,14%)"/>
      <stop offset="100%" stop-color="hsl(${hue2},45%,6%)"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="hsl(${hue2},90%,72%)" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="hsl(${hue2},90%,45%)" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#bg)"/>
  <circle cx="${(cx * width).toFixed(0)}" cy="${(cy * height).toFixed(0)}" r="${(r * height * 2).toFixed(0)}" fill="url(#glow)"/>
  <ellipse cx="${(cx * width).toFixed(0)}" cy="${(cy * height).toFixed(0)}" rx="${(r * width * 0.5).toFixed(0)}" ry="${(r * height * 0.95).toFixed(0)}" fill="hsl(${hue2},80%,60%)" opacity="0.85"/>
  <g opacity="0.95">
    ${Array.from({ length: 26 }, (_, k) => {
      const ang = (k / 26) * Math.PI * 2;
      const rx = cx * width + Math.cos(ang) * r * width * 0.42;
      const ry = cy * height + Math.sin(ang) * r * height * 0.78;
      return `<rect x="${rx.toFixed(0)}" y="${ry.toFixed(0)}" width="${(width * 0.012).toFixed(0)}" height="${(height * 0.02).toFixed(0)}" fill="${k % 2 ? '#ffffff' : '#000000'}" opacity="0.8"/>`;
    }).join('')}
  </g>
  <rect x="0" y="${(height * 0.82).toFixed(0)}" width="${width}" height="${(height * 0.18).toFixed(0)}" fill="#000" opacity="0.35"/>
  <text x="${(width * 0.04).toFixed(0)}" y="${(height * 0.95).toFixed(0)}" font-family="sans-serif" font-size="${Math.round(height * 0.035)}" fill="#ffffff" opacity="0.75">TEST MODE ARTWORK · variant ${i + 1}</text>
</svg>`;
      const data = await sharp(Buffer.from(svg))
        .toFormat(req.outputFormat === 'jpeg' ? 'jpeg' : 'png')
        .toBuffer();
      out.push({
        data,
        model: 'mock-image-model',
        quality: req.quality,
        size: `${width}x${height}`,
        requested: { model: req.model ?? 'mock-image-model', quality: req.quality, size: req.size },
        degradations: [
          {
            kind: 'model',
            requested: req.model ?? 'mock-image-model',
            actual: 'mock-image-model',
            reason: 'TEST_MODE: synthetisches Platzhalterbild, keine echte Bildgenerierung.',
          },
        ],
        latencyMs: Date.now() - started,
      });
    }
    return out;
  }
}

/** Returns plausible, schema-shaped JSON derived from the actual script text. */
export class MockTextProvider implements TextProvider {
  readonly id = 'mock';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(req: TextRequest): Promise<TextResult> {
    return { text: JSON.stringify(await this.build(req)), model: 'mock-analysis-model' };
  }

  async completeJson<T>(req: TextRequest): Promise<{ value: T; model: string }> {
    return { value: (await this.build(req)) as T, model: 'mock-analysis-model' };
  }

  /**
   * Measures the images that were actually handed in, so TEST_MODE scores move
   * with the pixels instead of being a hardcoded constant.
   */
  private async measure(req: TextRequest): Promise<Array<{ contrast: number; luminance: number; focus: number }>> {
    const buffers = (req.images ?? [])
      .map((i) => (typeof i === 'string' ? null : i.data))
      .filter((b): b is Buffer => Buffer.isBuffer(b));
    const out: Array<{ contrast: number; luminance: number; focus: number }> = [];
    for (const buf of buffers) {
      try {
        const stats = await sharp(buf).stats();
        const ch = stats.channels.slice(0, 3);
        const contrast = ch.reduce((a, c) => a + c.stdev, 0) / ch.length;
        const luminance = ch.reduce((a, c) => a + c.mean, 0) / ch.length;
        const { data, info } = await sharp(buf)
          .greyscale()
          .resize(192, 108, { fit: 'fill' })
          .raw()
          .toBuffer({ resolveWithObject: true });
        let sum = 0;
        let count = 0;
        for (let y = 1; y < info.height; y++) {
          for (let x = 1; x < info.width; x++) {
            const i = y * info.width + x;
            sum += Math.abs(data[i] - data[i - 1]) + Math.abs(data[i] - data[i - info.width]);
            count++;
          }
        }
        out.push({ contrast, luminance, focus: sum / Math.max(1, count) });
      } catch {
        /* unreadable payload is simply skipped */
      }
    }
    return out;
  }

  private async build(req: TextRequest): Promise<unknown> {
    const kind = req.jsonSchemaName ?? '';
    const text = req.user;
    const words = text
      .replace(/[^\p{L}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 6);
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w.toLowerCase(), (freq.get(w.toLowerCase()) ?? 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w]) => w);
    const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
    const titleMatch = text.match(/VIDEOTITEL:\s*(.+)/i) ?? text.match(/TITEL:\s*(.+)/i);
    const title = titleMatch ? titleMatch[1].trim() : cap(top[0] ?? 'Unbekanntes Thema');

    if (kind === 'script_analysis') {
      return {
        VIDEO_TITLE: title,
        VIDEO_TOPIC: cap(top[0] ?? 'Thema'),
        CORE_THESIS: `Das Skript argumentiert, dass ${top[0] ?? 'das Thema'} deutlich mehr Bedeutung hat als allgemein angenommen.`,
        PRIMARY_HOOK: `Ein überraschender Zusammenhang rund um ${top[1] ?? top[0] ?? 'das Thema'}.`,
        SECONDARY_HOOK: `Die offene Frage nach ${top[2] ?? 'den Hintergründen'}.`,
        EMOTIONAL_CORE: 'Staunen und der Wunsch, etwas Verborgenes zu verstehen.',
        KEY_CONFLICT: 'Überliefertes Wissen gegen moderne Deutung.',
        KEY_QUESTION: `Was wurde über ${top[0] ?? 'dieses Thema'} wirklich verschwiegen?`,
        KEY_MYSTERY: `Die ungeklärte Rolle von ${top[3] ?? top[0] ?? 'zentralen Objekten'}.`,
        IMPORTANT_PEOPLE: top.slice(0, 2).map(cap),
        IMPORTANT_OBJECTS: top.slice(2, 4).map(cap),
        IMPORTANT_LOCATIONS: top.slice(4, 6).map(cap),
        IMPORTANT_SYMBOLS: ['Licht gegen Dunkelheit', 'Kreis der Transformation'],
        HISTORICAL_ELEMENTS: top.slice(0, 2).map(cap),
        SCIENTIFIC_ELEMENTS: top.slice(2, 3).map(cap),
        SPIRITUAL_ELEMENTS: top.slice(3, 4).map(cap),
        VISUAL_METAPHORS: ['Substanz verwandelt sich in Licht', 'altes Manuskript trifft moderne Messung'],
        POSSIBLE_THUMBNAIL_SCENARIOS: [
          'Extreme Nahaufnahme eines leuchtenden Objekts',
          'Gesicht im Halbdunkel neben einem Symbol',
          'Split zwischen Vergangenheit und Gegenwart',
        ],
        THUMBNAIL_TEXT_CANDIDATES: ['DAS VERBORGENE WISSEN', 'SIE WUSSTEN MEHR', 'DIE WAHRE FORMEL'],
        WHY_THIS_THUMBNAIL_COULD_WORK:
          'Ein einzelner starker Fokus plus eine offene Frage erzeugt Neugier, ohne den Inhalt falsch darzustellen.',
        FACTUAL_STATEMENTS: text.split(/[.!?]\s/).slice(0, 3).map((s) => s.trim()).filter(Boolean),
        CREATIVE_INTERPRETATIONS: ['Die leuchtende Substanz ist eine symbolische Darstellung, keine dokumentierte Szene.'],
        SUGGESTED_STYLE: 'CINEMATIC_DOCUMENTARY',
        LANGUAGE: 'de',
      };
    }

    if (kind === 'thumbnail_concepts') {
      const positions = ['RIGHT_TEXT', 'LEFT_TEXT', 'BOTTOM_TEXT', 'TOP_TEXT', 'RIGHT_TEXT'];
      const labels = [
        'Zentrale Figur + mysteriöses Symbol',
        'Split-Screen historisch vs. modern',
        'Ungewöhnliches Objekt als Mittelpunkt',
        'Große menschliche Reaktion',
        'Surreal-symbolische Szene',
      ];
      return {
        concepts: labels.map((label, i) => ({
          id: `C${i + 1}`,
          label,
          strategy: THUMBNAIL_STRATEGIES[i % THUMBNAIL_STRATEGIES.length],
          emotion: ['Anspannung', 'Staunen', 'Neugier', 'Erschütterung', 'Ehrfurcht'][i % 5],
          idea: `${label} rund um ${top[i % Math.max(top.length, 1)] ?? 'das Kernthema'}.`,
          subject: i === 2 ? `Ein einzelnes ${cap(top[2] ?? 'Objekt')} in extremer Nahaufnahme` : `Eine markante Figur im Kontext von ${top[0] ?? 'dem Thema'}`,
          action: 'hält inne, während sich etwas Unerwartetes ereignet',
          environment: `Atmosphärische Umgebung passend zu ${top[1] ?? 'dem Thema'}`,
          era: 'historisch anmutend, zeitlos inszeniert',
          composition: i % 2 === 0 ? 'Motiv links, freie Fläche rechts' : 'Motiv rechts, freie Fläche links',
          camera: i === 2 ? 'Makro, 85mm, sehr geringe Schärfentiefe' : '35mm, leicht untersichtige Perspektive',
          lighting: 'gerichtetes Kerzen-/Schlüssellicht, tiefe Schatten',
          color: 'tiefes Blaugrün gegen warmes Bernstein',
          mood: 'geheimnisvoll, hochwertig, dokumentarisch',
          depth: 'klare Trennung von Vorder-, Mittel- und Hintergrund',
          detail: 'wenige, aber präzise Details am Hauptmotiv',
          visualMetaphor: 'Verborgenes wird sichtbar',
          textArea: positions[i],
          style: 'CINEMATIC_DOCUMENTARY',
          thumbnailText: ['DAS VERBORGENE WISSEN', 'SIE WUSSTEN MEHR', 'DIE WAHRE FORMEL', 'WAS NIEMAND SAH', 'DER LETZTE BEWEIS'][i],
          unusual: i === 2 || i === 4,
          rationale: 'Starker Einzelfokus, klare Silhouette, ausreichend Textfläche.',
          score: {
            ATTENTION: 8 - (i % 3), CURIOSITY: 9 - (i % 2), INSTANT_COMPREHENSION: 8,
            EMOTIONAL_IMPACT: 7 + (i % 2), VISUAL_CLARITY: 8, SUBJECT_PROMINENCE: 9 - (i % 3),
            COMPOSITION: 8, CONTRAST: 9 - (i % 2), COLOR_DIVERSITY: 7, SMALL_SCREEN_READABILITY: 8,
            TITLE_ALIGNMENT: 8, NOVELTY: i === 2 ? 9 : 6, CLICK_INTENT: 8, CONTENT_ACCURACY: 9,
            VISUAL_SIMPLICITY: 8,
          },
        })),
      };
    }

    if (kind === 'variant_critique') {
      const m = (await this.measure(req))[0];
      const clamp = (v: number) => Math.max(0, Math.min(10, Math.round(v * 10) / 10));
      const contrast = m ? clamp(m.contrast / 7) : 5;
      const focus = m ? clamp(m.focus / 3) : 5;
      const exposure = m ? clamp(10 - Math.abs(m.luminance - 118) / 14) : 5;
      const base = clamp((contrast + focus + exposure) / 3);
      return {
        firstImpression: m
          ? `Messwerte: Kontrast ${m.contrast.toFixed(1)}, Helligkeit ${m.luminance.toFixed(1)}, Kantenenergie ${m.focus.toFixed(2)}.`
          : 'Kein auswertbares Bild übergeben.',
        mainSubject: 'Hellster, detailreichster Bereich des Platzhalterbildes',
        topicClear: base >= 5,
        createsCuriosity: focus >= 4,
        hierarchyClear: focus >= 4,
        textAreaSufficient: true,
        textAreaLocation: 'RIGHT_TEXT',
        overloaded: focus > 8.5,
        looksPremium: base >= 6,
        looksLikeRealThumbnail: false,
        feelsGeneric: true,
        smallSizeVerdict: `Kontrast ${contrast.toFixed(1)}/10 bleibt in der Kleinansicht erhalten.`,
        smallSizeReadable: contrast >= 4,
        visualContradictions: [],
        anatomyOrPerspectiveErrors: [],
        artifacts: [],
        defects: base < 5 ? ['Zu geringer Kontrast bzw. zu schwacher Fokus im Platzhalterbild.'] : [],
        fixableByEdit: base >= 4,
        titleImageConnection: 'TEST_MODE: synthetisches Bild, keine inhaltliche Bewertung möglich.',
        reasons: [
          `Kontrast-Messung ergibt ${contrast.toFixed(1)}/10.`,
          `Fokus-/Kantenmessung ergibt ${focus.toFixed(1)}/10.`,
          `Belichtung ergibt ${exposure.toFixed(1)}/10.`,
          'Bewertung stammt aus TEST_MODE-Pixelmessung, nicht aus einem Vision-Modell.',
        ],
        score: {
          ATTENTION: contrast, CURIOSITY: focus, INSTANT_COMPREHENSION: base,
          EMOTIONAL_IMPACT: clamp(base - 1), VISUAL_CLARITY: exposure,
          SUBJECT_PROMINENCE: focus, COMPOSITION: base, CONTRAST: contrast,
          COLOR_DIVERSITY: clamp(contrast - 1), SMALL_SCREEN_READABILITY: contrast,
          TITLE_ALIGNMENT: base, NOVELTY: clamp(focus - 2), CLICK_INTENT: base,
          CONTENT_ACCURACY: base, VISUAL_SIMPLICITY: clamp(10 - focus),
        },
        improvementPrompt: 'Hauptmotiv vergrößern, Hintergrund beruhigen, Textfläche freihalten.',
        summary: `TEST_MODE-Messbewertung: Gesamteindruck ${base.toFixed(1)}/10.`,
      };
    }

    if (kind === 'visual_ranking') {
      const measured = await this.measure(req);
      const indices = [...String(req.user).matchAll(/#(\d+)/g)].map((x) => Number(x[1]));
      const unique = [...new Set(indices)];
      // Two payloads per candidate (full + 320px view) — score on the full view.
      const scored = unique.map((idx, i) => {
        const m = measured[i * 2] ?? measured[i];
        return { idx, value: m ? m.contrast / 7 + m.focus / 3 : 0 };
      });
      scored.sort((a, b) => b.value - a.value);
      return {
        order: scored.map((s2) => s2.idx),
        winner: scored[0]?.idx ?? unique[0] ?? 1,
        reason: 'TEST_MODE: Reihenfolge nach gemessenem Kontrast und Kantenenergie der echten Bilddateien.',
        perCandidate: scored.map((s2) => ({
          index: s2.idx,
          verdict: `Messwert ${s2.value.toFixed(2)} (Kontrast + Fokus).`,
        })),
      };
    }

    if (kind === 'final_check') {
      const m = (await this.measure(req))[0];
      return {
        approved: !m || m.contrast > 12,
        issues: m && m.contrast <= 12 ? ['Sehr geringer Gesamtkontrast im fertigen Thumbnail.'] : [],
        notes: m
          ? `TEST_MODE-Messung: Kontrast ${m.contrast.toFixed(1)}, Helligkeit ${m.luminance.toFixed(1)}.`
          : 'Kein Bild übergeben.',
      };
    }

    if (kind === 'thumbnail_text') {
      return { text: 'DAS VERBORGENE WISSEN', reason: 'Kurz, deutsch, neugierig machend und inhaltlich gedeckt.' };
    }

    if (kind === 'final_selection') {
      return { selectedIndex: 1, reason: 'Stärkster Einzelfokus und beste Lesbarkeit in der Kleinansicht.' };
    }

    if (kind === 'reference_style') {
      return {
        composition: 'Motiv außermittig, große ruhige Fläche gegenüber',
        lighting: 'gerichtetes Schlüssellicht mit tiefen Schatten',
        visual_density: 'niedrig',
        color_mood: 'dunkle Basis mit einem warmen Akzent',
        imagery: 'dokumentarisch, greifbar, wenig Effekte',
        text_placement: 'seitlich auf ruhiger Fläche',
        style_summary: 'Hochwertige, dunkle Dokumentarästhetik mit einem einzigen Lichtakzent.',
      };
    }

    if (kind === 'mobile_check') {
      return { textReadable: true, subjectRecognizable: true, compositionClear: true, notes: 'In 320px noch klar lesbar.' };
    }

    return { ok: true };
  }
}
