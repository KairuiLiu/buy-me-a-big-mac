export type Ingredient =
  | 'lettuce' | 'patty' | 'cheese' | 'sesame' | 'fries'
  | 'bun-top' | 'bun-bottom' | 'pickle' | 'onion' | 'tomato' | 'nugget' | 'chicken';
// Give the substantial ingredients most of the burst; sesame is only 1 in 20.
export const ingredients: Ingredient[] = [
  'lettuce', 'bun-top', 'cheese', 'patty', 'tomato',
  'nugget', 'pickle', 'bun-bottom', 'fries', 'onion',
  'chicken', 'lettuce', 'cheese', 'nugget', 'sesame',
  'bun-top', 'tomato', 'pickle', 'patty', 'chicken',
];
interface IngredientAppearance { ingredient: Ingredient; size: number; variation: number; }

const outlineColor = '#32251D';

interface MenuIngredient {
  width: number;
  center: [number, number];
  outline: string;
  fill: string;
  details: { path: string; color: string; width: number }[];
}

// These outlines are the individual food layers in the local demo illustrations.
// Keeping their original coordinates also makes future illustration edits simple.
const menuIngredients: Partial<Record<Ingredient, MenuIngredient>> = {
  'bun-top': {
    width: 275,
    center: [240, 98],
    outline: 'M109 141C111 66 176 52 240 52S369 66 371 141Z',
    fill: '#EFB84D',
    details: [
      { path: 'M133 116C151 78 186 68 223 68', color: '#F9D584', width: 8 },
      { path: 'm197 93 8-5m43-7 8 3m36 11 8-4m-125 25 7 2m135-3 7 4', color: '#FFF0BA', width: 8 },
    ],
  },
  'bun-bottom': {
    width: 275,
    center: [240, 278],
    outline: 'M109 256h262c0 36-27 45-54 45H163c-27 0-54-9-54-45Z',
    fill: '#E6A640',
    details: [
      { path: 'M130 273c28 11 187 14 222 0', color: '#F8CE76', width: 8 },
    ],
  },
  nugget: {
    width: 115,
    center: [169, 144],
    outline: 'M149 180c-35-2-47-30-26-51 4-25 48-36 65-15 30-7 53 27 30 43-12 30-42 15-69 23Z',
    fill: '#D6973F',
    details: [
      { path: 'm145 135 13-5m22 25 10-5', color: '#F1BE6A', width: 5 },
    ],
  },
  chicken: {
    width: 285,
    center: [240, 214],
    outline: 'M123 191c10-26 32-30 50-20 20-20 44-10 57-1 15-15 39-20 62-3 25-12 45-1 52 14 27 2 39 19 27 44 9 22-13 34-35 29-16 17-40 12-58 6-15 15-34 7-49 2-20 10-43 7-58-4-20 11-37 2-46-12-28 1-32-40-2-55Z',
    fill: '#C78035',
    details: [
      { path: 'm147 200 12-8m26 24 15-4m47-26 17-3m54 21 13 5m-107 27 16-4m57 13 13-5', color: '#E8B862', width: 9 },
    ],
  },
};
const pathCache = new Map<string, Path2D>();

function vectorPath(source: string): Path2D {
  let path = pathCache.get(source);
  if (!path) {
    path = new Path2D(source);
    pathCache.set(source, path);
  }
  return path;
}

function drawIngredient(context: CanvasRenderingContext2D, particle: IngredientAppearance) {
  const { ingredient, size, variation } = particle;
  context.scale(size, size);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  context.lineWidth = 0.045;
  context.strokeStyle = outlineColor;

  const menuIngredient = menuIngredients[ingredient];
  if (menuIngredient) {
    context.scale(1 / menuIngredient.width, 1 / menuIngredient.width);
    context.translate(-menuIngredient.center[0], -menuIngredient.center[1]);
    context.lineWidth = menuIngredient.width * 0.035;
    context.fillStyle = menuIngredient.fill;
    const outline = vectorPath(menuIngredient.outline);
    context.fill(outline);
    context.stroke(outline);
    for (const detail of menuIngredient.details) {
      context.strokeStyle = detail.color;
      context.lineWidth = detail.width;
      context.stroke(vectorPath(detail.path));
    }
    return;
  }

  if (ingredient === 'lettuce') {
    context.beginPath();
    context.moveTo(0.05, 0.55);
    context.bezierCurveTo(-0.1, 0.39, -0.48, 0.42, -0.4, 0.18);
    context.bezierCurveTo(-0.63, 0.08, -0.4, -0.15, -0.43, -0.27);
    context.bezierCurveTo(-0.42, -0.5, -0.18, -0.32, -0.11, -0.5);
    context.bezierCurveTo(0.01, -0.68, 0.2, -0.32, 0.32, -0.39);
    context.bezierCurveTo(0.58, -0.46, 0.39, -0.15, 0.49, -0.09);
    context.bezierCurveTo(0.64, 0.09, 0.26, 0.44, 0.05, 0.55);
    context.fillStyle = variation > 0.5 ? '#748B36' : '#738336';
    context.fill();
    context.stroke();
    context.strokeStyle = '#b5ca70';
    context.beginPath();
    context.moveTo(0.05, 0.5);
    context.quadraticCurveTo(-0.03, 0.13, 0.04, -0.36);
    context.moveTo(0.02, 0.17);
    context.lineTo(-0.24, -0.01);
    context.moveTo(0, -0.03);
    context.lineTo(0.28, -0.23);
    context.moveTo(0.01, -0.2);
    context.lineTo(-0.2, -0.3);
    context.stroke();
  } else if (ingredient === 'patty') {
    context.beginPath();
    context.ellipse(0, 0, 0.56, 0.34, 0, 0, Math.PI * 2);
    context.fillStyle = variation > 0.5 ? '#74492E' : '#633b28';
    context.fill();
    context.stroke();
    context.strokeStyle = '#986345';
    context.lineWidth = 0.045;
    for (let index = -1; index <= 1; index++) {
      context.beginPath();
      context.moveTo(index * 0.21 - 0.12, -0.18);
      context.lineTo(index * 0.21 + 0.05, 0.16);
      context.stroke();
    }
  } else if (ingredient === 'cheese') {
    context.beginPath();
    context.moveTo(-0.46, -0.44);
    context.lineTo(0.47, -0.37);
    context.lineTo(0.41, 0.44);
    if (variation > 0.5) context.lineTo(-0.43, 0.35);
    context.closePath();
    context.fillStyle = variation > 0.5 ? '#F1C440' : '#F4CB49';
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(0.47, -0.37);
    context.lineTo(0.22, -0.36);
    context.lineTo(0.45, -0.14);
    context.closePath();
    context.fillStyle = '#ffe28b';
    context.fill();
  } else if (ingredient === 'sesame') {
    context.beginPath();
    context.ellipse(0, 0, 0.2, 0.5, 0.13, 0, Math.PI * 2);
    context.fillStyle = '#FFF0BA';
    context.fill();
    context.strokeStyle = '#cfa969';
    context.lineWidth = 0.065;
    context.stroke();
  } else if (ingredient === 'fries') {
    context.beginPath();
    context.moveTo(-0.11, -0.57);
    context.lineTo(0.13, -0.52);
    context.lineTo(0.1, 0.57);
    context.lineTo(-0.13, 0.52);
    context.closePath();
    context.fillStyle = '#efad22';
    context.fill();
    context.stroke();
    context.fillStyle = '#ffe18a';
    context.fillRect(-0.08, -0.47, 0.075, 0.92);
  } else if (ingredient === 'pickle') {
    context.beginPath();
    context.ellipse(0, 0, 0.49, 0.36, -0.08, 0, Math.PI * 2);
    context.fillStyle = '#748B36';
    context.fill();
    context.stroke();
    context.beginPath();
    context.ellipse(0, 0, 0.36, 0.24, -0.08, 0, Math.PI * 2);
    context.fillStyle = '#B6BC69';
    context.fill();
    context.strokeStyle = '#E2D794';
    context.lineWidth = 0.05;
    for (let seed = 0; seed < 6; seed++) {
      const angle = seed * Math.PI / 3;
      context.beginPath();
      context.moveTo(Math.cos(angle) * 0.11, Math.sin(angle) * 0.07);
      context.lineTo(Math.cos(angle) * 0.22, Math.sin(angle) * 0.16);
      context.stroke();
    }
  } else if (ingredient === 'onion') {
    context.beginPath();
    context.ellipse(0, 0, 0.49, 0.38, 0.08, 0, Math.PI * 2);
    context.moveTo(Math.cos(0.08) * 0.29, Math.sin(0.08) * 0.29);
    context.ellipse(0, 0, 0.29, 0.2, 0.08, 0, Math.PI * 2);
    context.fillStyle = '#EDDAC6';
    context.fill('evenodd');
    context.stroke();
    context.beginPath();
    context.ellipse(0, 0, 0.4, 0.29, 0.08, 0, Math.PI * 2);
    context.strokeStyle = '#B97883';
    context.lineWidth = 0.035;
    context.stroke();
  } else if (ingredient === 'tomato') {
    context.beginPath();
    context.ellipse(0, 0, 0.5, 0.41, 0, 0, Math.PI * 2);
    context.fillStyle = '#C94C37';
    context.fill();
    context.stroke();
    context.beginPath();
    context.ellipse(0, 0, 0.37, 0.29, 0, 0, Math.PI * 2);
    context.fillStyle = '#ED8663';
    context.fill();
    context.strokeStyle = '#F4B07A';
    context.lineWidth = 0.06;
    for (let segment = 0; segment < 4; segment++) {
      const angle = segment * Math.PI / 2 + 0.4;
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(Math.cos(angle) * 0.31, Math.sin(angle) * 0.24);
      context.stroke();
    }
    context.fillStyle = '#F5D78C';
    for (let seed = 0; seed < 4; seed++) {
      const angle = seed * Math.PI / 2 + 1.05;
      context.beginPath();
      context.ellipse(Math.cos(angle) * 0.24, Math.sin(angle) * 0.19, 0.032, 0.047, angle, 0, Math.PI * 2);
      context.fill();
    }
  }
}


export const SPRITE_EXTENT = 1.8;

/** Pre-render every ingredient once; animation frames only rotate and draw sprites. */
export function prepareIngredientSprites(pixelRatio: number): Map<string, HTMLCanvasElement> {
  const sprites = new Map<string, HTMLCanvasElement>();
  const resolution = Math.ceil(96 * Math.min(2, Math.max(1, pixelRatio)));
  for (const ingredient of new Set(ingredients)) {
    for (const variation of [0.25, 0.75]) {
      const surface = document.createElement('canvas');
      surface.width = resolution;
      surface.height = resolution;
      const context = surface.getContext('2d');
      if (!context) continue;
      context.translate(resolution / 2, resolution / 2);
      drawIngredient(context, { ingredient, size: resolution / SPRITE_EXTENT, variation });
      sprites.set(`${ingredient}:${variation > 0.5 ? 1 : 0}`, surface);
    }
  }
  return sprites;
}
