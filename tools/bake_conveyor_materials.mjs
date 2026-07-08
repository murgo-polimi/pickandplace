import fs from "node:fs";
import zlib from "node:zlib";

const inputPath = new URL("../Conveyor.glb", import.meta.url);
const outputPath = new URL("../Conveyor_baked.glb", import.meta.url);

const COMPONENT_SIZE = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4
};
const TYPE_COUNT = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
  MAT4: 16
};
let crcTable = null;

const glb = fs.readFileSync(inputPath);
const { gltf, bin } = readGlb(glb);
let binary = Buffer.from(bin);
if (gltf.extras?.materialBake) {
  console.log("Skipping Conveyor.glb; it is already a baked material asset.");
  process.exit(0);
}

const textures = {
  aluminum: createMotorAluminumTextures(512),
  satinSteel: createSatinMetalWearTextures(512),
  rubber: createRubberTextures(512),
  fastener: createDarkFastenerTextures(256)
};

const textureIndices = {
  aluminum: addTexturePair(gltf, "Baked light satin aluminum", textures.aluminum),
  satinSteel: addTexturePair(gltf, "Baked darker satin steel", textures.satinSteel),
  rubber: addTexturePair(gltf, "Baked lightly scuffed rubber", textures.rubber),
  fastener: addTexturePair(gltf, "Baked dark steel fasteners", textures.fastener)
};

bakePlanarUvs(gltf.meshes[0], "wear");
bakePlanarUvs(gltf.meshes[1], "wear");
bakePlanarUvs(gltf.meshes[2], "belt");
bakePlanarUvs(gltf.meshes[3], "wear");
bakePlanarUvs(gltf.meshes[10], "wear");
bakePlanarUvs(gltf.meshes[11], "wear");
bakePlanarUvs(gltf.meshes[12], "wear");

const rubberMaterial = addMaterial(gltf, {
  name: "Baked Rubber Belt",
  baseColorFactor: [0.88, 0.88, 0.84, 1],
  baseColorTexture: textureIndices.rubber.albedo,
  normalTexture: textureIndices.rubber.normal,
  normalScale: 0.2,
  metallicFactor: 0,
  roughnessFactor: 0.91
});
const motorCoverMaterial = addMaterial(gltf, {
  name: "Baked Darker Motor Metal Cover",
  baseColorFactor: [0.62, 0.61, 0.57, 1],
  baseColorTexture: textureIndices.satinSteel.albedo,
  normalTexture: textureIndices.satinSteel.normal,
  normalScale: 0.045,
  metallicFactor: 0.86,
  roughnessFactor: 0.84
});
const fastenerMaterial = addMaterial(gltf, {
  name: "Baked Dark Steel Motor Fasteners",
  baseColorFactor: [0.34, 0.35, 0.33, 1],
  baseColorTexture: textureIndices.fastener.albedo,
  normalTexture: textureIndices.fastener.normal,
  normalScale: 0.026,
  metallicFactor: 0.9,
  roughnessFactor: 0.66
});

setMaterial(gltf.materials[0], {
  name: "Baked Conveyor Satin Aluminum",
  baseColorFactor: [0.82, 0.82, 0.78, 1],
  baseColorTexture: textureIndices.aluminum.albedo,
  normalTexture: textureIndices.aluminum.normal,
  normalScale: 0.034,
  metallicFactor: 0.92,
  roughnessFactor: 0.78
});
setMaterial(gltf.materials[1], {
  name: "Baked Black Polymer Supports",
  metallicFactor: 0,
  roughnessFactor: 0.68
});
setMaterial(gltf.materials[5], {
  name: "Baked Black Polymer Motor Part",
  metallicFactor: 0,
  roughnessFactor: 0.68
});
for (const index of [2, 3, 6, 7]) {
  setMaterial(gltf.materials[index], {
    metallicFactor: 0,
    roughnessFactor: 0.52
  });
}
setMaterial(gltf.materials[8], {
  name: "Baked Matte Red Motor Cover",
  baseColorFactor: [0.86, 0.04, 0.035, 1],
  metallicFactor: 0,
  roughnessFactor: 0.82
});
delete gltf.materials[8].emissiveTexture;
gltf.materials[8].emissiveFactor = [0, 0, 0];

gltf.meshes[2].primitives[0].material = rubberMaterial;
gltf.meshes[10].primitives[0].material = motorCoverMaterial;
gltf.meshes[11].primitives[0].material = fastenerMaterial;
gltf.meshes[12].primitives[0].material = fastenerMaterial;

gltf.asset = gltf.asset || { version: "2.0" };
gltf.asset.generator = "pickandplace material bake";
gltf.extras = {
  ...(gltf.extras || {}),
  materialBake: {
    source: "Conveyor.glb",
    geometryPositionsModified: false,
    bakedTextures: ["rubber belt", "satin aluminum", "satin steel", "dark steel fasteners"],
    note: "Only materials, texture coordinates, and embedded texture data were changed."
  }
};

gltf.buffers[0].byteLength = binary.length;
const output = writeGlb(gltf, binary);
fs.writeFileSync(outputPath, output);
console.log(`Wrote ${outputPath.pathname}`);
console.log(`Input ${glb.length.toLocaleString()} bytes -> output ${output.length.toLocaleString()} bytes`);

function readGlb(buffer) {
  if (buffer.toString("utf8", 0, 4) !== "glTF") {
    throw new Error("Input is not a GLB.");
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version ${version}.`);
  }

  let offset = 12;
  let json = null;
  let binChunk = Buffer.alloc(0);
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.toString("utf8", offset + 4, offset + 8);
    const start = offset + 8;
    const chunk = buffer.subarray(start, start + length);
    if (type === "JSON") {
      json = JSON.parse(chunk.toString("utf8").trim());
    } else if (type === "BIN\0") {
      binChunk = chunk;
    }
    offset = start + length;
  }
  if (!json) throw new Error("GLB has no JSON chunk.");
  return { gltf: json, bin: binChunk };
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

function padBuffer(buffer, byte) {
  const padding = (4 - (buffer.length % 4)) % 4;
  if (!padding) return buffer;
  return Buffer.concat([buffer, Buffer.alloc(padding, byte)]);
}

function appendBinary(bytes) {
  const before = binary.length;
  const aligned = padBuffer(binary, 0);
  const byteOffset = aligned.length;
  binary = Buffer.concat([aligned, Buffer.from(bytes)]);
  return { byteOffset, byteLength: bytes.length, padding: byteOffset - before };
}

function addBufferView(bytes) {
  gltf.bufferViews = gltf.bufferViews || [];
  const appended = appendBinary(bytes);
  const index = gltf.bufferViews.length;
  gltf.bufferViews.push({
    buffer: 0,
    byteOffset: appended.byteOffset,
    byteLength: appended.byteLength
  });
  return index;
}

function addAccessor(bytes, count, min, max) {
  const bufferView = addBufferView(bytes);
  gltf.accessors = gltf.accessors || [];
  const index = gltf.accessors.length;
  gltf.accessors.push({
    bufferView,
    byteOffset: 0,
    componentType: 5126,
    count,
    type: "VEC2",
    min,
    max
  });
  return index;
}

function addTexturePair(gltfDoc, name, pair) {
  const albedo = addPngTexture(gltfDoc, `${name} albedo`, encodePng(pair.albedo.width, pair.albedo.height, pair.albedo.data));
  const normal = addPngTexture(gltfDoc, `${name} normal`, encodePng(pair.normal.width, pair.normal.height, pair.normal.data));
  return { albedo, normal };
}

function addPngTexture(gltfDoc, name, png) {
  gltfDoc.images = gltfDoc.images || [];
  gltfDoc.textures = gltfDoc.textures || [];
  gltfDoc.samplers = gltfDoc.samplers || [];
  const sampler = getRepeatSampler(gltfDoc);
  const bufferView = addBufferView(png);
  const image = gltfDoc.images.length;
  gltfDoc.images.push({ name, bufferView, mimeType: "image/png" });
  const texture = gltfDoc.textures.length;
  gltfDoc.textures.push({ name, sampler, source: image });
  return texture;
}

function getRepeatSampler(gltfDoc) {
  const existing = gltfDoc.samplers.findIndex(sampler =>
    sampler.magFilter === 9729 &&
    sampler.minFilter === 9987 &&
    sampler.wrapS === 10497 &&
    sampler.wrapT === 10497
  );
  if (existing >= 0) return existing;
  gltfDoc.samplers.push({
    magFilter: 9729,
    minFilter: 9987,
    wrapS: 10497,
    wrapT: 10497
  });
  return gltfDoc.samplers.length - 1;
}

function addMaterial(gltfDoc, options) {
  gltfDoc.materials = gltfDoc.materials || [];
  const index = gltfDoc.materials.length;
  gltfDoc.materials.push({});
  setMaterial(gltfDoc.materials[index], options);
  return index;
}

function setMaterial(material, options) {
  material.name = options.name || material.name;
  material.pbrMetallicRoughness = material.pbrMetallicRoughness || {};
  const pbr = material.pbrMetallicRoughness;
  if (options.baseColorFactor) pbr.baseColorFactor = options.baseColorFactor;
  if (options.baseColorTexture !== undefined) pbr.baseColorTexture = { index: options.baseColorTexture };
  if (options.metallicFactor !== undefined) pbr.metallicFactor = options.metallicFactor;
  if (options.roughnessFactor !== undefined) pbr.roughnessFactor = options.roughnessFactor;
  if (options.normalTexture !== undefined) {
    material.normalTexture = { index: options.normalTexture, scale: options.normalScale ?? 1 };
  }
}

function bakePlanarUvs(mesh, mode) {
  const primitive = mesh.primitives[0];
  const positions = readAccessorVec3(primitive.attributes.POSITION);
  const uvs = mode === "belt" ? beltUvs(positions) : wearUvs(positions);
  primitive.attributes.TEXCOORD_0 = writeUvAccessor(uvs);
}

function readAccessorVec3(accessorIndex) {
  const accessor = gltf.accessors[accessorIndex];
  const bufferView = gltf.bufferViews[accessor.bufferView];
  const components = TYPE_COUNT[accessor.type];
  const componentSize = COMPONENT_SIZE[accessor.componentType];
  const stride = bufferView.byteStride || components * componentSize;
  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const values = [];
  for (let i = 0; i < accessor.count; i += 1) {
    const base = byteOffset + i * stride;
    values.push(
      binary.readFloatLE(base),
      binary.readFloatLE(base + componentSize),
      binary.readFloatLE(base + componentSize * 2)
    );
  }
  return values;
}

function writeUvAccessor(values) {
  const buffer = Buffer.alloc(values.length * 4);
  let minU = Number.POSITIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < values.length; i += 2) {
    minU = Math.min(minU, values[i]);
    maxU = Math.max(maxU, values[i]);
    minV = Math.min(minV, values[i + 1]);
    maxV = Math.max(maxV, values[i + 1]);
    buffer.writeFloatLE(values[i], i * 4);
    buffer.writeFloatLE(values[i + 1], (i + 1) * 4);
  }
  return addAccessor(buffer, values.length / 2, [minU, minV], [maxU, maxV]);
}

function beltUvs(positions) {
  const min = { x: Number.POSITIVE_INFINITY, z: Number.POSITIVE_INFINITY };
  const max = { x: Number.NEGATIVE_INFINITY, z: Number.NEGATIVE_INFINITY };
  for (let i = 0; i < positions.length; i += 3) {
    min.x = Math.min(min.x, positions[i]);
    max.x = Math.max(max.x, positions[i]);
    min.z = Math.min(min.z, positions[i + 2]);
    max.z = Math.max(max.z, positions[i + 2]);
  }
  const width = Math.max(max.x - min.x, 1);
  const depth = Math.max(max.z - min.z, 1);
  const uvs = [];
  for (let i = 0; i < positions.length; i += 3) {
    uvs.push(((positions[i] - min.x) / width) * 8, ((positions[i + 2] - min.z) / depth) * 2.4);
  }
  return uvs;
}

function wearUvs(positions) {
  const axes = [
    { index: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    { index: 1, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    { index: 2, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
  ];
  for (let i = 0; i < positions.length; i += 3) {
    for (const axis of axes) {
      const value = positions[i + axis.index];
      axis.min = Math.min(axis.min, value);
      axis.max = Math.max(axis.max, value);
    }
  }
  axes.forEach(axis => {
    axis.size = Math.max(axis.max - axis.min, 1);
  });
  axes.sort((a, b) => b.size - a.size);
  const uAxis = axes[0];
  const vAxis = axes[1];
  const maxSize = Math.max(uAxis.size, vAxis.size);
  const uRepeat = Math.max(1.02, (uAxis.size / maxSize) * 1.35);
  const vRepeat = Math.max(1.02, (vAxis.size / maxSize) * 1.35);
  const uvs = [];
  for (let i = 0; i < positions.length; i += 3) {
    uvs.push(
      ((positions[i + uAxis.index] - uAxis.min) / uAxis.size) * uRepeat,
      ((positions[i + vAxis.index] - vAxis.min) / vAxis.size) * vRepeat
    );
  }
  return uvs;
}

function createSatinMetalWearTextures(size) {
  const albedo = rgbaImage(size, size);
  const normal = rgbaImage(size, size);
  const heights = new Float32Array(size * size);
  const scuffs = createRandomMetalScuffs(size, 54, 20260601);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warpX = (fbmNoise(x * 0.006, y * 0.006, 17, 4) - 0.5) * 86;
      const warpY = (fbmNoise(x * 0.007, y * 0.005, 31, 4) - 0.5) * 86;
      const broadMottle = fbmNoise((x + warpX) * 0.0048, (y + warpY) * 0.0048, 43, 5) - 0.5;
      const softMottle = fbmNoise((x - warpY) * 0.011, (y + warpX) * 0.011, 59, 4) - 0.5;
      const satinNoise = fbmNoise((x + warpX * 0.08) * 0.055, (y + warpY * 0.08) * 0.055, 71, 3) - 0.5;
      const microGrain = hashNoise(x, y, 83) - 0.5;
      const scuff = metalScuffAt(x, y, scuffs);
      const wear = broadMottle * 0.07 + softMottle * 0.045 + scuff.albedo * 0.08;
      const height = 0.5 + satinNoise * 0.014 + microGrain * 0.006 + broadMottle * 0.025 + scuff.height * 0.06;
      const i = y * size + x;
      heights[i] = height;
      const shade = clamp(182 + wear * 76 + satinNoise * 8 + microGrain * 4, 154, 224);
      const p = i * 4;
      albedo.data[p] = shade;
      albedo.data[p + 1] = clamp(shade * 0.985, 0, 255);
      albedo.data[p + 2] = clamp(shade * 0.94, 0, 255);
      albedo.data[p + 3] = 255;
    }
  }
  fillNormalTexture(normal, heights, size, 0.9, 1.1);
  return { albedo, normal };
}

function createMotorAluminumTextures(size) {
  const albedo = rgbaImage(size, size);
  const normal = rgbaImage(size, size);
  const heights = new Float32Array(size * size);
  const scuffs = createRandomMetalScuffs(size, 28, 20260602);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warpX = (fbmNoise(x * 0.007, y * 0.006, 211, 4) - 0.5) * 64;
      const warpY = (fbmNoise(x * 0.006, y * 0.007, 223, 4) - 0.5) * 64;
      const mottle = fbmNoise((x + warpX) * 0.0052, (y + warpY) * 0.0052, 229, 5) - 0.5;
      const satin = fbmNoise((x - warpY * 0.05) * 0.07, (y + warpX * 0.05) * 0.07, 233, 3) - 0.5;
      const micro = hashNoise(x, y, 239) - 0.5;
      const scuff = metalScuffAt(x, y, scuffs);
      const wear = mottle * 0.045 + satin * 0.035 + scuff.albedo * 0.045;
      const height = 0.5 + mottle * 0.018 + satin * 0.011 + micro * 0.004 + scuff.height * 0.035;
      const i = y * size + x;
      heights[i] = height;
      const shade = clamp(211 + wear * 70 + satin * 7 + micro * 3, 184, 244);
      const p = i * 4;
      albedo.data[p] = clamp(shade * 1.02, 0, 255);
      albedo.data[p + 1] = shade;
      albedo.data[p + 2] = clamp(shade * 0.95, 0, 255);
      albedo.data[p + 3] = 255;
    }
  }
  fillNormalTexture(normal, heights, size, 0.78, 0.9);
  return { albedo, normal };
}

function createDarkFastenerTextures(size) {
  const albedo = rgbaImage(size, size);
  const normal = rgbaImage(size, size);
  const heights = new Float32Array(size * size);
  const scuffs = createRandomMetalScuffs(size, 18, 20260603);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const satin = fbmNoise(x * 0.05, y * 0.055, 307, 3) - 0.5;
      const mottle = fbmNoise(x * 0.013, y * 0.012, 311, 4) - 0.5;
      const micro = hashNoise(x, y, 313) - 0.5;
      const scuff = metalScuffAt(x, y, scuffs);
      const height = 0.5 + satin * 0.014 + mottle * 0.018 + micro * 0.004 + scuff.height * 0.04;
      const i = y * size + x;
      heights[i] = height;
      const shade = clamp(82 + mottle * 18 + satin * 10 + micro * 4 + scuff.albedo * 18, 56, 122);
      const p = i * 4;
      albedo.data[p] = shade;
      albedo.data[p + 1] = clamp(shade * 1.02, 0, 255);
      albedo.data[p + 2] = clamp(shade * 0.96, 0, 255);
      albedo.data[p + 3] = 255;
    }
  }
  fillNormalTexture(normal, heights, size, 0.75, 0.75);
  return { albedo, normal };
}

function createRubberTextures(size) {
  const albedo = rgbaImage(size, size);
  const normal = rgbaImage(size, size);
  const heights = new Float32Array(size * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warpX = (fbmNoise(x * 0.01, y * 0.012, 211, 4) - 0.5) * 28;
      const warpY = (fbmNoise(x * 0.008, y * 0.014, 223, 4) - 0.5) * 18;
      const longScarField = fbmNoise((x + warpX) * 0.018, (y + warpY) * 0.34, 239, 4);
      const fineLinearScar = Math.sin((y + warpY * 0.2) * 5.7 + fbmNoise(x * 0.018, y * 0.045, 251, 3) * 4.4) * 0.5 + 0.5;
      const fineRubberGrain = fbmNoise(x * 0.34 + warpX * 0.018, y * 0.5 + warpY * 0.018, 263, 3) - 0.5;
      const sparseScuffField = fbmNoise((x - warpY) * 0.024, (y + warpX) * 0.038, 277, 5);
      const sparseScuff = smoothStep(0.82, 0.96, sparseScuffField);
      const hairlineScuff = smoothStep(0.84, 0.98, fbmNoise(x * 0.08, y * 0.015 + warpY * 0.005, 281, 3));
      const grain = hashNoise(x, y, 293) - 0.5;
      const linearScars = (longScarField - 0.5) * 0.12 + (fineLinearScar - 0.5) * 0.045;
      const lightScuffs = sparseScuff * 0.045 + hairlineScuff * 0.018;
      const height = 0.5 + linearScars + lightScuffs + fineRubberGrain * 0.035 + grain * 0.024;
      const i = y * size + x;
      heights[i] = height;
      const shade = clamp(22 + height * 48 + lightScuffs * 140 + linearScars * 62 + fineRubberGrain * 10 + grain * 10, 14, 82);
      const p = i * 4;
      albedo.data[p] = shade;
      albedo.data[p + 1] = shade + 1;
      albedo.data[p + 2] = shade;
      albedo.data[p + 3] = 255;
    }
  }
  fillNormalTexture(normal, heights, size, 2.2, 4.2);
  return { albedo, normal };
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

function createRandomMetalScuffs(size, count, seed) {
  const random = seededRandom(seed);
  const scuffs = [];
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI;
    const length = 34 + Math.pow(random(), 1.35) * 172;
    const width = 1.3 + Math.pow(random(), 2.2) * 7.2;
    const pale = random() > 0.32;
    const strength = (pale ? 1 : -0.55) * (0.28 + random() * 0.72);
    scuffs.push({
      x: random() * size,
      y: random() * size,
      ca: Math.cos(angle),
      sa: Math.sin(angle),
      halfLength: length * 0.5,
      width,
      albedo: strength,
      height: strength * (0.22 + random() * 0.28),
      size
    });
  }
  return scuffs;
}

function metalScuffAt(x, y, scuffs) {
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
    const alongMask = 1 - smoothStep(scuff.halfLength * 0.62, scuff.halfLength, Math.abs(along));
    const acrossMask = 1 - smoothStep(scuff.width * 0.25, scuff.width, Math.abs(across));
    const mask = alongMask * acrossMask;
    albedo += mask * scuff.albedo;
    height += mask * scuff.height;
  }
  return {
    albedo: clamp(albedo, -1, 1),
    height: clamp(height, -1, 1)
  };
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
  if (!crcTable) {
    crcTable = createCrcTable();
  }
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
  const top = lerp(a, b, sx);
  const bottom = lerp(c, d, sx);
  return lerp(top, bottom, sy);
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
