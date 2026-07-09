import fs from "node:fs";
import zlib from "node:zlib";

const DEFAULT_SOURCE = "/Users/marcello/politecnico/DIDATTICA/SIP/PARTI/680/Casappa/23269680.stl";
const DEFAULT_OUTPUT = "../Part_from_stl.glb";
const DEFAULT_MATERIAL = "satinSteel";
const DEFAULT_POSITION_SCALE = 0.0005;
const SOURCE_TO_METER_SCALE = 0.001;

const sourcePath = process.argv[2] || DEFAULT_SOURCE;
const outputPath = new URL(process.argv[3] || DEFAULT_OUTPUT, import.meta.url);
const materialVariant = process.argv[4] || DEFAULT_MATERIAL;
const positionScale = parsePositionScale(process.argv[5] || String(DEFAULT_POSITION_SCALE));

const RELIEF_FLATTENING = {
  minX: -50,
  maxX: 32,
  minY: -20,
  maxY: 20,
  minZ: 86.55,
  targetZ: 86.5
};

let crcTable = null;

const stl = fs.readFileSync(sourcePath);
const rawTriangles = readBinaryStl(stl);
const flattenedTriangles = flattenLogoRelief(rawTriangles, RELIEF_FLATTENING);
const meshData = buildMeshData(flattenedTriangles, positionScale);
const material = createPartMaterial(materialVariant, 512);
const glb = writePartGlb(meshData, material, sourcePath);

fs.writeFileSync(outputPath, glb);

console.log(`Read ${rawTriangles.length.toLocaleString()} STL triangles.`);
console.log(`Wrote ${outputPath.pathname}`);
console.log(`Material ${material.name}`);
console.log(`Position scale ${positionScale}`);
console.log(`Kept ${meshData.triangleCount.toLocaleString()} triangles after flattening/removing degenerate faces.`);
console.log(`Flattened ${meshData.flattenedVertexCount.toLocaleString()} vertices in the Casappa/logo relief area.`);

function parsePositionScale(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid position scale "${value}". Use a positive numeric scale.`);
  }
  return parsed;
}

function readBinaryStl(buffer) {
  if (buffer.length < 84) {
    throw new Error("STL file is too small to be a binary STL.");
  }
  const triangleCount = buffer.readUInt32LE(80);
  const expectedLength = 84 + triangleCount * 50;
  if (expectedLength > buffer.length) {
    throw new Error(`Binary STL is truncated: expected ${expectedLength} bytes, found ${buffer.length}.`);
  }

  const triangles = [];
  for (let triangleIndex = 0, offset = 84; triangleIndex < triangleCount; triangleIndex += 1, offset += 50) {
    const vertices = [];
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
      const base = offset + 12 + vertexIndex * 12;
      vertices.push([
        buffer.readFloatLE(base),
        buffer.readFloatLE(base + 4),
        buffer.readFloatLE(base + 8)
      ]);
    }
    triangles.push(vertices);
  }
  return triangles;
}

function flattenLogoRelief(triangles, bounds) {
  return triangles.map(triangle =>
    triangle.map(vertex => {
      const [x, y, z] = vertex;
      if (
        x >= bounds.minX &&
        x <= bounds.maxX &&
        y >= bounds.minY &&
        y <= bounds.maxY &&
        z > bounds.minZ
      ) {
        return [x, y, bounds.targetZ, true];
      }
      return [x, y, z, false];
    })
  );
}

function buildMeshData(triangles, scale) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  let triangleCount = 0;
  let flattenedVertexCount = 0;

  for (const triangle of triangles) {
    const p0 = triangle[0];
    const p1 = triangle[1];
    const p2 = triangle[2];
    const normal = triangleNormal(p0, p1, p2);
    if (!normal) continue;

    const faceUvs = faceUvCoordinates(triangle, normal);
    for (let i = 0; i < 3; i += 1) {
      const vertex = triangle[i];
      const scaledVertex = [
        vertex[0] * scale,
        vertex[1] * scale,
        vertex[2] * scale
      ];
      if (vertex[3]) flattenedVertexCount += 1;
      positions.push(scaledVertex[0], scaledVertex[1], scaledVertex[2]);
      normals.push(normal[0], normal[1], normal[2]);
      uvs.push(faceUvs[i][0], faceUvs[i][1]);
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], scaledVertex[axis]);
        max[axis] = Math.max(max[axis], scaledVertex[axis]);
      }
    }
    triangleCount += 1;
  }

  return {
    positions,
    normals,
    uvs,
    min,
    max,
    triangleCount,
    flattenedVertexCount
  };
}

function triangleNormal(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length < 1e-7) return null;
  return [nx / length, ny / length, nz / length];
}

function faceUvCoordinates(triangle, normal) {
  const abs = normal.map(Math.abs);
  const repeatMm = 55;
  if (abs[2] >= abs[0] && abs[2] >= abs[1]) {
    return triangle.map(vertex => [vertex[0] / repeatMm, vertex[1] / repeatMm]);
  }
  if (abs[0] >= abs[1]) {
    return triangle.map(vertex => [vertex[1] / repeatMm, vertex[2] / repeatMm]);
  }
  return triangle.map(vertex => [vertex[0] / repeatMm, vertex[2] / repeatMm]);
}

function writePartGlb(meshData, material, source) {
  const binaryParts = [];
  const bufferViews = [];
  const accessors = [];
  const images = [];
  const texturesJson = [];
  const samplers = [{
    magFilter: 9729,
    minFilter: 9987,
    wrapS: 10497,
    wrapT: 10497
  }];

  const positionView = addBinaryPart(binaryParts, bufferViews, floatBuffer(meshData.positions), 34962);
  const normalView = addBinaryPart(binaryParts, bufferViews, floatBuffer(meshData.normals), 34962);
  const uvView = addBinaryPart(binaryParts, bufferViews, floatBuffer(meshData.uvs), 34962);
  const albedoView = addBinaryPart(binaryParts, bufferViews, encodePng(material.textures.albedo.width, material.textures.albedo.height, material.textures.albedo.data));
  const normalTextureView = addBinaryPart(binaryParts, bufferViews, encodePng(material.textures.normal.width, material.textures.normal.height, material.textures.normal.data));

  const vertexCount = meshData.positions.length / 3;
  const positionAccessor = addAccessor(accessors, positionView, 5126, vertexCount, "VEC3", meshData.min, meshData.max);
  const normalAccessor = addAccessor(accessors, normalView, 5126, vertexCount, "VEC3");
  const uvAccessor = addAccessor(accessors, uvView, 5126, vertexCount, "VEC2");

  images.push({ name: `${material.textureLabel} albedo`, bufferView: albedoView, mimeType: "image/png" });
  images.push({ name: `${material.textureLabel} normal`, bufferView: normalTextureView, mimeType: "image/png" });
  texturesJson.push({ name: `${material.textureLabel} albedo`, sampler: 0, source: 0 });
  texturesJson.push({ name: `${material.textureLabel} normal`, sampler: 0, source: 1 });

  const gltf = {
    asset: {
      version: "2.0",
      generator: "pickandplace STL part converter"
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "Part" }],
    meshes: [{
      name: "Part",
      primitives: [{
        attributes: {
          POSITION: positionAccessor,
          NORMAL: normalAccessor,
          TEXCOORD_0: uvAccessor
        },
        material: 0,
        mode: 4
      }]
    }],
    materials: [{
      name: material.name,
      pbrMetallicRoughness: {
        baseColorFactor: material.baseColorFactor,
        baseColorTexture: { index: 0 },
        metallicFactor: material.metallicFactor,
        roughnessFactor: material.roughnessFactor
      },
      normalTexture: {
        index: 1,
        scale: material.normalScale
      },
      doubleSided: false
    }],
    samplers,
    textures: texturesJson,
    images,
    accessors,
    bufferViews,
    buffers: [{ byteLength: binaryParts.reduce((sum, part) => sum + part.length, 0) }],
    extras: {
      materialBake: {
        source,
        sourceUnit: "millimeter",
        outputUnit: "meter",
        positionScale,
        sourceToMeterScale: SOURCE_TO_METER_SCALE,
        sizeMultiplierAfterUnitConversion: positionScale / SOURCE_TO_METER_SCALE,
        geometryPositionsModified: true,
        flattenedLogoRelief: true,
        flattenedReliefBounds: RELIEF_FLATTENING,
        bakedTextures: [material.label],
        materialVariant,
        note: `Converted from STL, scaled the positions into meters, flattened the central Casappa/logo relief, and embedded ${material.label} material textures.`
      }
    }
  };

  return writeGlb(gltf, Buffer.concat(binaryParts));
}

function createPartMaterial(variant, size) {
  if (variant === "satinSteel") {
    return {
      name: "Baked Satin Steel",
      label: "satin steel",
      textureLabel: "Baked satin steel",
      baseColorFactor: [0.62, 0.64, 0.63, 1],
      metallicFactor: 0.98,
      roughnessFactor: 0.66,
      normalScale: 0.04,
      textures: createSatinSteelTextures(size)
    };
  }
  if (variant === "bluePlastic") {
    return {
      name: "Baked Blue Plastic",
      label: "blue plastic",
      textureLabel: "Baked blue plastic",
      baseColorFactor: [0.055, 0.19, 0.62, 1],
      metallicFactor: 0,
      roughnessFactor: 0.72,
      normalScale: 0.034,
      textures: createCleanPlasticTextures(size, {
        base: [18, 72, 182],
        min: [8, 42, 112],
        max: [72, 124, 228],
        seed: 903
      })
    };
  }
  if (variant === "greenPlastic") {
    return {
      name: "Baked Green Plastic",
      label: "green plastic",
      textureLabel: "Baked green plastic",
      baseColorFactor: [0.04, 0.46, 0.2, 1],
      metallicFactor: 0,
      roughnessFactor: 0.68,
      normalScale: 0.034,
      textures: createCleanPlasticTextures(size, {
        base: [18, 142, 70],
        min: [8, 82, 34],
        max: [76, 194, 112],
        seed: 937
      })
    };
  }
  throw new Error(`Unknown material variant "${variant}". Use satinSteel, bluePlastic, or greenPlastic.`);
}

function addBinaryPart(parts, bufferViews, bytes, target) {
  const alignedLength = alignLength(parts.reduce((sum, part) => sum + part.length, 0), 4);
  const currentLength = parts.reduce((sum, part) => sum + part.length, 0);
  if (alignedLength > currentLength) {
    parts.push(Buffer.alloc(alignedLength - currentLength));
  }
  const byteOffset = alignedLength;
  const index = bufferViews.length;
  const view = {
    buffer: 0,
    byteOffset,
    byteLength: bytes.length
  };
  if (target) view.target = target;
  bufferViews.push(view);
  parts.push(bytes);
  return index;
}

function addAccessor(accessors, bufferView, componentType, count, type, min, max) {
  const accessor = {
    bufferView,
    byteOffset: 0,
    componentType,
    count,
    type
  };
  if (min) accessor.min = min;
  if (max) accessor.max = max;
  accessors.push(accessor);
  return accessors.length - 1;
}

function floatBuffer(values) {
  const buffer = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    buffer.writeFloatLE(values[i], i * 4);
  }
  return buffer;
}

function writeGlb(gltf, binChunk) {
  const jsonBytes = Buffer.from(JSON.stringify(gltf));
  const paddedJson = padBuffer(jsonBytes, 0x20);
  const paddedBin = padBuffer(binChunk, 0x00);
  const totalLength = 12 + 8 + paddedJson.length + 8 + paddedBin.length;
  const header = Buffer.alloc(12);
  header.write("glTF", 0, 4, "utf8");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(paddedJson.length, 0);
  jsonHeader.write("JSON", 4, 4, "utf8");
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(paddedBin.length, 0);
  binHeader.write("BIN\0", 4, 4, "utf8");
  return Buffer.concat([header, jsonHeader, paddedJson, binHeader, paddedBin], totalLength);
}

function createSatinSteelTextures(size) {
  const albedo = rgbaImage(size, size);
  const normal = rgbaImage(size, size);
  const heights = new Float32Array(size * size);
  const scuffs = createRandomSteelScuffs(size, 22, 20260708);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warpX = (fbmNoise(x * 0.006, y * 0.007, 811, 4) - 0.5) * 52;
      const warpY = (fbmNoise(x * 0.007, y * 0.006, 823, 4) - 0.5) * 48;
      const wx = x + warpX;
      const wy = y + warpY;
      const mottle = fbmNoise(wx * 0.0048, wy * 0.0044, 829, 5) - 0.5;
      const satin = fbmNoise(wx * 0.052, wy * 0.041, 839, 4) - 0.5;
      const cross = fbmNoise((wx + wy * 0.35) * 0.022, (wy - wx * 0.18) * 0.028, 853, 3) - 0.5;
      const micro = hashNoise(x, y, 857) - 0.5;
      const scuff = steelScuffAt(x, y, scuffs);
      const height = 0.5 + mottle * 0.014 + satin * 0.012 + cross * 0.008 + micro * 0.0035 + scuff.height * 0.018;
      const shade = clamp(156 + mottle * 18 + satin * 13 + cross * 7 + micro * 4 + scuff.albedo * 10, 118, 205);
      const p = (y * size + x) * 4;
      heights[y * size + x] = height;
      albedo.data[p] = clamp(shade * 0.96, 0, 255);
      albedo.data[p + 1] = clamp(shade * 0.995, 0, 255);
      albedo.data[p + 2] = clamp(shade * 1.02, 0, 255);
      albedo.data[p + 3] = 255;
    }
  }

  fillNormalTexture(normal, heights, size, 0.68, 0.68);
  return { albedo, normal };
}

function createCleanPlasticTextures(size, palette) {
  const albedo = rgbaImage(size, size);
  const normal = rgbaImage(size, size);
  const heights = new Float32Array(size * size);
  const [baseR, baseG, baseB] = palette.base;
  const [minR, minG, minB] = palette.min;
  const [maxR, maxG, maxB] = palette.max;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warpX = (fbmNoise(x * 0.007, y * 0.009, palette.seed, 4) - 0.5) * 58;
      const warpY = (fbmNoise(x * 0.009, y * 0.007, palette.seed + 8, 4) - 0.5) * 52;
      const wx = x + warpX;
      const wy = y + warpY;
      const cloudy = fbmNoise(wx * 0.0046, wy * 0.0042, palette.seed + 18, 5) - 0.5;
      const handling = fbmNoise(wx * 0.021, wy * 0.018, palette.seed + 26, 4) - 0.5;
      const stipple = fbmNoise(wx * 0.082, wy * 0.079, palette.seed + 30, 3) - 0.5;
      const micro = hashNoise(x, y, palette.seed + 32) - 0.5;
      const height = 0.5 + cloudy * 0.008 + handling * 0.006 + stipple * 0.004 + micro * 0.0025;
      const p = (y * size + x) * 4;
      heights[y * size + x] = height;
      albedo.data[p] = clamp(baseR + cloudy * 7 + handling * 4 + micro * 2, minR, maxR);
      albedo.data[p + 1] = clamp(baseG + cloudy * 11 + handling * 6 + micro * 2, minG, maxG);
      albedo.data[p + 2] = clamp(baseB + cloudy * 18 + handling * 12 + micro * 4, minB, maxB);
      albedo.data[p + 3] = 255;
    }
  }

  fillNormalTexture(normal, heights, size, 0.62, 0.62);
  return { albedo, normal };
}

function createRandomSteelScuffs(size, count, seed) {
  const random = seededRandom(seed);
  const scuffs = [];
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI;
    const length = 20 + Math.pow(random(), 1.4) * 132;
    const width = 0.9 + Math.pow(random(), 2.2) * 4.4;
    const bright = random() > 0.42;
    const strength = (bright ? 1 : -0.65) * (0.14 + random() * 0.62);
    scuffs.push({
      x: random() * size,
      y: random() * size,
      ca: Math.cos(angle),
      sa: Math.sin(angle),
      halfLength: length * 0.5,
      width,
      albedo: strength,
      height: strength * (0.1 + random() * 0.2),
      size
    });
  }
  return scuffs;
}

function steelScuffAt(x, y, scuffs) {
  let albedo = 0;
  let height = 0;
  for (const scuff of scuffs) {
    let dx = x - scuff.x;
    let dy = y - scuff.y;
    if (dx > scuff.size * 0.5) dx -= scuff.size;
    if (dx < -scuff.size * 0.5) dx += scuff.size;
    if (dy > scuff.size * 0.5) dy -= scuff.size;
    if (dy < -scuff.size * 0.5) dy += scuff.size;
    const along = dx * scuff.ca + dy * scuff.sa;
    const across = -dx * scuff.sa + dy * scuff.ca;
    const alongMask = 1 - smoothStep(scuff.halfLength * 0.65, scuff.halfLength, Math.abs(along));
    const acrossMask = 1 - smoothStep(scuff.width * 0.22, scuff.width, Math.abs(across));
    const mask = alongMask * acrossMask;
    albedo += mask * scuff.albedo;
    height += mask * scuff.height;
  }
  return {
    albedo: clamp(albedo, -1, 1),
    height: clamp(height, -1, 1)
  };
}

function fillNormalTexture(image, heights, size, xStrength, yStrength) {
  const heightAt = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (heightAt(x - 1, y) - heightAt(x + 1, y)) * xStrength;
      const dy = (heightAt(x, y - 1) - heightAt(x, y + 1)) * yStrength;
      const dz = 1;
      const length = Math.hypot(dx, dy, dz) || 1;
      const p = (y * size + x) * 4;
      image.data[p] = ((dx / length) * 0.5 + 0.5) * 255;
      image.data[p + 1] = ((dy / length) * 0.5 + 0.5) * 255;
      image.data[p + 2] = ((dz / length) * 0.5 + 0.5) * 255;
      image.data[p + 3] = 255;
    }
  }
}

function rgbaImage(width, height) {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, row + 1);
  }
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function ihdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 6;
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  if (!crcTable) crcTable = createCrcTable();
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

function padBuffer(buffer, byte) {
  const padding = (4 - (buffer.length % 4)) % 4;
  if (!padding) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(padding, byte)]);
}

function alignLength(value, alignment) {
  return Math.ceil(value / alignment) * alignment;
}

function smoothStep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function hashNoise(x, y, seed) {
  const value = Math.sin((x + seed * 19.19) * 127.1 + (y - seed * 7.73) * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const tx = x - xi;
  const ty = y - yi;
  const sx = smoothStep(0, 1, tx);
  const sy = smoothStep(0, 1, ty);
  const a = hashNoise(xi, yi, seed);
  const b = hashNoise(xi + 1, yi, seed);
  const c = hashNoise(xi, yi + 1, seed);
  const d = hashNoise(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
}

function fbmNoise(x, y, seed, octaves) {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency, seed + octave * 17.31) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return norm > 0 ? sum / norm : 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
