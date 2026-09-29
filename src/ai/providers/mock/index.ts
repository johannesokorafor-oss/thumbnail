import crypto from 'node:crypto';
import sharp from 'sharp';
import type { GeneratedImage, ImageProvider, ImageRequest, TextProvider, TextRequest, TextResult } from '../types.js';

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

  async generate(req: ImageRequest): Promise<GeneratedImage[]> {
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
  <rect x="0" y="${(height * 0.82).toFixed(0)}" width="${width}" height="${(height * 0.18).toFixed(0)}" fill="#000" opacity="0.35"/>
  <text x="${(width * 0.04).toFixed(0)}" y="${(height * 0.95).toFixed(0)}" font-family="sans-serif" font-size="${Math.round(height * 0.035)}" fill="#ffffff" opacity="0.75">TEST MODE ARTWORK · variant ${i + 1}</text>
</svg>`;
      const data = await sharp(Buffer.from(svg))
        .toFormat(req.outputFormat === 'jpeg' ? 'jpeg' : 'png')
        .toBuffer();
      out.push({ data, model: 'mock-image-model', quality: req.quality, size: `${width}x${height}` });
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
    return { text: JSON.stringify(this.build(req)), model: 'mock-analysis-model' };
  }

  async completeJson<T>(req: TextRequest): Promise<{ value: T; model: string }> {
    return { value: this.build(req) as T, model: 'mock-analysis-model' };
  }

  private build(req: TextRequest): unknown {
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
      return {
        firstImpression: 'Das leuchtende Hauptmotiv in der linken Bildhälfte.',
        mainSubject: 'Zentrales Motiv mit klarer Silhouette',
        topicClear: true,
        createsCuriosity: true,
        hierarchyClear: true,
        textAreaSufficient: true,
        textAreaLocation: 'RIGHT_TEXT',
        overloaded: false,
        looksPremium: true,
        looksLikeRealThumbnail: true,
        visualContradictions: [],
        anatomyOrPerspectiveErrors: [],
        artifacts: [],
        titleImageConnection: 'Bild ergänzt den Titel, ohne ihn zu wiederholen.',
        score: {
          ATTENTION: 8, CURIOSITY: 8, INSTANT_COMPREHENSION: 8, EMOTIONAL_IMPACT: 7,
          VISUAL_CLARITY: 8, SUBJECT_PROMINENCE: 8, COMPOSITION: 8, CONTRAST: 8,
          COLOR_DIVERSITY: 7, SMALL_SCREEN_READABILITY: 8, TITLE_ALIGNMENT: 8,
          NOVELTY: 7, CLICK_INTENT: 8, CONTENT_ACCURACY: 9, VISUAL_SIMPLICITY: 8,
        },
        improvementPrompt: 'Hauptmotiv 10% größer, Hintergrund weiter beruhigen, Textfläche rechts freihalten.',
        summary: 'Solide, klare Komposition mit ausreichender Textfläche.',
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
