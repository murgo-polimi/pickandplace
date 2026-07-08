import fs from "node:fs";
import zlib from "node:zlib";

const TARGETS = [
  { source: "../Grid.glb", output: "../Grid_baked.glb", selection: "all", material: "satinAluminum" },
  { source: "../Grid_Hole.glb", output: "../Grid_Hole_baked.glb", selection: "all", material: "satinAluminum" },
  { source: "../Grid_second.glb", output: "../Grid_second_baked.glb", selection: "all", material: "satinAluminum" },
  { source: "../Pick_and_Place_Robot.glb", output: "../Pick_and_Place_Robot_baked.glb", selection: "white", material: "brushedAluminum" },
  { source: "../CommandBox.glb", output: "../CommandBox_baked.glb", selection: "commandBoxBody", material: "brushedAluminum" },
  { source: "../SignalPole.glb", output: "../SignalPole_baked.glb", selection: "signalPoleMetal", material: "signalPoleBrushedAluminum" }
];

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

for (const target of TARGETS) {
  bakeSatinAluminumMaterial(target);
}

function bakeSatinAluminumMaterial(target) {
  const inputPath = new URL(target.source, import.meta.url);
  const outputPath = new URL(target.output, import.meta.url);
  const glb = fs.readFileSync(inputPath);
  const context = readGlb(glb);
  const sourceName = inputPath.pathname.split("/").pop();
  if (context.gltf.extras?.materialBake) {
    if (target.selection === "commandBoxBody") {
      augmentBakedCommandBox(context, outputPath, glb.length);
      return;
    }
    if (target.selection === "signalPoleMetal") {
      augmentBakedSignalPole(context, outputPath, glb.length, target.material);
      return;
    }
    console.log(`Skipping ${sourceName}; it is already a baked material asset.`);
    return;
  }

  const bakedMaterial = createBakedMaterial(context, target.material);

  let primitiveCount = 0;
  for (const mesh of context.gltf.meshes || []) {
    for (let primitiveIndex = 0; primitiveIndex < (mesh.primitives || []).length; primitiveIndex += 1) {
      const primitive = mesh.primitives[primitiveIndex];
      if (primitive.attributes?.POSITION === undefined) continue;
      if (!shouldBakePrimitive(context.gltf, mesh, primitive, primitiveIndex, target.selection)) continue;
      bakePlanarUvs(context, primitive);
      primitive.material = bakedMaterial.index;
      primitiveCount += 1;
    }
  }

  if (target.selection === "commandBoxBody") {
    darkenCommandBoxControlMaterials(context.gltf);
  }

  context.gltf.asset = context.gltf.asset || { version: "2.0" };
  context.gltf.asset.generator = "pickandplace grid material bake";
  context.gltf.extras = {
    ...(context.gltf.extras || {}),
    materialBake: {
      source: sourceName,
      geometryPositionsModified: false,
      bakedTextures: [bakedMaterial.label],
      selection: target.selection,
      primitiveCount,
      note: "Only material assignment, texture coordinates, and embedded texture data were changed."
    }
  };

  context.gltf.buffers[0].byteLength = context.binary.length;
  const output = writeGlb(context.gltf, context.binary);
  fs.writeFileSync(outputPath, output);
  console.log(`Wrote ${outputPath.pathname}`);
  console.log(`Input ${glb.length.toLocaleString()} bytes -> output ${output.length.toLocaleString()} bytes`);
}

function augmentBakedCommandBox(context, outputPath, inputByteLength) {
  const materialIndex = findMaterialIndex(context.gltf, "Baked Brushed Aluminum");
  if (materialIndex < 0) {
    throw new Error("CommandBox.glb is baked, but has no Baked Brushed Aluminum material.");
  }

  darkenCommandBoxControlMaterials(context.gltf);

  let primitiveCount = 0;
  for (const mesh of context.gltf.meshes || []) {
    for (let primitiveIndex = 0; primitiveIndex < (mesh.primitives || []).length; primitiveIndex += 1) {
      const primitive = mesh.primitives[primitiveIndex];
      if (primitive.attributes?.POSITION === undefined) continue;
      if (!isCommandBoxTopPlate(mesh, primitiveIndex)) continue;
      if (primitive.material !== materialIndex) {
        bakePlanarUvs(context, primitive);
        primitive.material = materialIndex;
        primitiveCount += 1;
      }
    }
  }

  context.gltf.extras = {
    ...(context.gltf.extras || {}),
    materialBake: {
      ...(context.gltf.extras?.materialBake || {}),
      source: "CommandBox.glb",
      geometryPositionsModified: false,
      bakedTextures: ["brushed aluminum"],
      selection: "commandBoxBodyAndTopPlate",
      primitiveCount: (context.gltf.extras?.materialBake?.primitiveCount || 0) + primitiveCount,
      darkenedCommandControls: true,
      note: "Only material assignment, texture coordinates, and embedded texture data were changed."
    }
  };

  context.gltf.buffers[0].byteLength = context.binary.length;
  const output = writeGlb(context.gltf, context.binary);
  fs.writeFileSync(outputPath, output);
  console.log(`Updated ${outputPath.pathname}`);
  console.log(`Input ${inputByteLength.toLocaleString()} bytes -> output ${output.length.toLocaleString()} bytes`);
}

function augmentBakedSignalPole(context, outputPath, inputByteLength, material) {
  const materialIndex = findMaterialIndex(context.gltf, "Baked Brushed Aluminum");
  if (materialIndex < 0) {
    throw new Error("SignalPole.glb is baked, but has no Baked Brushed Aluminum material.");
  }

  applyBakedMaterialToIndex(context, materialIndex, material);

  let primitiveCount = 0;
  for (const mesh of context.gltf.meshes || []) {
    for (let primitiveIndex = 0; primitiveIndex < (mesh.primitives || []).length; primitiveIndex += 1) {
      const primitive = mesh.primitives[primitiveIndex];
      if (primitive.attributes?.POSITION === undefined) continue;
      if (!shouldBakePrimitive(context.gltf, mesh, primitive, primitiveIndex, "signalPoleMetal")) continue;
      if (primitive.attributes.TEXCOORD_0 === undefined) {
        bakePlanarUvs(context, primitive);
      }
      primitive.material = materialIndex;
      primitiveCount += 1;
    }
  }

  context.gltf.extras = {
    ...(context.gltf.extras || {}),
    materialBake: {
      ...(context.gltf.extras?.materialBake || {}),
      source: "SignalPole.glb",
      geometryPositionsModified: false,
      bakedTextures: ["randomized brushed aluminum"],
      selection: "signalPoleMetal",
      primitiveCount,
      textureVariant: "randomizedBrushedAluminum",
      note: "Only material assignment, texture coordinates, and embedded texture data were changed."
    }
  };

  context.gltf.buffers[0].byteLength = context.binary.length;
  const output = writeGlb(context.gltf, context.binary);
  fs.writeFileSync(outputPath, output);
  console.log(`Updated ${outputPath.pathname}`);
  console.log(`Input ${inputByteLength.toLocaleString()} bytes -> output ${output.length.toLocaleString()} bytes`);
}

function findMaterialIndex(gltf, name) {
  return (gltf.materials || []).findIndex(material => material.name === name);
}

function darkenCommandBoxControlMaterials(gltf) {
  setNamedMaterialColor(gltf, "StateSelector_material3", [0.24, 0.245, 0.235, 1], 0.68);
  setNamedMaterialColor(gltf, "Potentiometer_material3", [0.24, 0.245, 0.235, 1], 0.68);
  setNamedMaterialColor(gltf, "StateSelector_material2", [0.105, 0.11, 0.105, 1], 0.72);
  setNamedMaterialColor(gltf, "Potentiometer_material2", [0.105, 0.11, 0.105, 1], 0.72);
}

function setNamedMaterialColor(gltf, name, baseColorFactor, roughnessFactor) {
  const material = (gltf.materials || []).find(candidate => candidate.name === name);
  if (!material) return;
  material.pbrMetallicRoughness = material.pbrMetallicRoughness || {};
  material.pbrMetallicRoughness.baseColorFactor = baseColorFactor;
  material.pbrMetallicRoughness.metallicFactor = 0;
  material.pbrMetallicRoughness.roughnessFactor = roughnessFactor;
}

function createBakedMaterial(context, material) {
  if (material === "brushedAluminum" || material === "signalPoleBrushedAluminum") {
    const options = bakedBrushedAluminumOptions(context, material);
    return {
      index: addMaterial(context, options),
      label: options.label
    };
  }

  const textures = createMotorAluminumTextures(512);
  const textureIndices = addTexturePair(context, "Baked conveyor satin aluminum", textures);
  return {
    index: addMaterial(context, {
      name: "Baked Conveyor Satin Aluminum",
      baseColorFactor: [0.82, 0.82, 0.78, 1],
      baseColorTexture: textureIndices.albedo,
      normalTexture: textureIndices.normal,
      normalScale: 0.034,
      metallicFactor: 0.92,
      roughnessFactor: 0.78
    }),
    label: "conveyor satin aluminum"
  };
}

function applyBakedMaterialToIndex(context, materialIndex, material) {
  const options = bakedBrushedAluminumOptions(context, material);
  setMaterial(context.gltf.materials[materialIndex], options);
}

function bakedBrushedAluminumOptions(context, material) {
  const isSignalPole = material === "signalPoleBrushedAluminum";
  const textures = isSignalPole
    ? createRandomizedBrushedAluminumTextures(512)
    : createBrushedAluminumTextures(512);
  const textureName = isSignalPole ? "Baked randomized brushed aluminum" : "Baked brushed aluminum";
  const textureIndices = addTexturePair(context, textureName, textures);
  return {
    name: "Baked Brushed Aluminum",
    label: isSignalPole ? "randomized brushed aluminum" : "brushed aluminum",
    baseColorFactor: isSignalPole ? [0.74, 0.745, 0.715, 1] : [0.72, 0.73, 0.7, 1],
    baseColorTexture: textureIndices.albedo,
    normalTexture: textureIndices.normal,
    normalScale: isSignalPole ? 0.052 : 0.075,
    metallicFactor: 0.95,
    roughnessFactor: isSignalPole ? 0.62 : 0.57
  };
}

function shouldBakePrimitive(gltf, mesh, primitive, primitiveIndex, selection) {
  if (selection === "all") return true;
  if (selection === "white") {
    const material = gltf.materials?.[primitive.material];
    const name = material?.name || "";
    const baseColor = material?.pbrMetallicRoughness?.baseColorFactor;
    if (/white/i.test(name)) return true;
    if (!baseColor) return false;
    const [r, g, b] = baseColor;
    return Math.min(r, g, b) > 0.78 && Math.max(r, g, b) - Math.min(r, g, b) < 0.08;
  }
  if (selection === "commandBoxBody") {
    const name = gltf.materials?.[primitive.material]?.name || "";
    return /ABS\s*\(White\)|Aluminum\s*-\s*Brushed\s*Linear/i.test(name) || isCommandBoxTopPlate(mesh, primitiveIndex);
  }
  if (selection === "signalPoleMetal") {
    return /MetalBody|MetalPlatform/i.test(mesh.name || "");
  }
  return false;
}

function isCommandBoxTopPlate(mesh, primitiveIndex) {
  return mesh.name === "Body1.005" && primitiveIndex === 1;
}

function readGlb(buffer) {
  if (buffer.toString("utf8", 0, 4) !== "glTF") {
    throw new Error("Input is not a GLB.");
  }
  const version = buffer.readUInt32LE(4);
  if (version !== 2) {
    throw new Error(`Unsupported GLB version ${version}.`);
  }

  let offset = 12;
  let gltf = null;
  let bin = Buffer.alloc(0);
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.toString("utf8", offset + 4, offset + 8);
    const start = offset + 8;
    const chunk = buffer.subarray(start, start + length);
    if (type === "JSON") {
      gltf = JSON.parse(chunk.toString("utf8").trim());
    } else if (type === "BIN\0") {
      bin = chunk;
    }
    offset = start + length;
  }
  if (!gltf) throw new Error("GLB has no JSON chunk.");
  return { gltf, binary: Buffer.from(bin) };
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

function appendBinary(context, bytes) {
  const aligned = padBuffer(context.binary, 0);
  const byteOffset = aligned.length;
  context.binary = Buffer.concat([aligned, Buffer.from(bytes)]);
  return { byteOffset, byteLength: bytes.length };
}

function addBufferView(context, bytes) {
  context.gltf.bufferViews = context.gltf.bufferViews || [];
  const appended = appendBinary(context, bytes);
  const index = context.gltf.bufferViews.length;
  context.gltf.bufferViews.push({
    buffer: 0,
    byteOffset: appended.byteOffset,
    byteLength: appended.byteLength
  });
  return index;
}

function addAccessor(context, bytes, count, min, max) {
  const bufferView = addBufferView(context, bytes);
  context.gltf.accessors = context.gltf.accessors || [];
  const index = context.gltf.accessors.length;
  context.gltf.accessors.push({
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

function addTexturePair(context, name, pair) {
  const albedo = addPngTexture(context, `${name} albedo`, encodePng(pair.albedo.width, pair.albedo.height, pair.albedo.data));
  const normal = addPngTexture(context, `${name} normal`, encodePng(pair.normal.width, pair.normal.height, pair.normal.data));
  return { albedo, normal };
}

function addPngTexture(context, name, png) {
  const gltf = context.gltf;
  gltf.images = gltf.images || [];
  gltf.textures = gltf.textures || [];
  gltf.samplers = gltf.samplers || [];
  const sampler = getRepeatSampler(gltf);
  const bufferView = addBufferView(context, png);
  const image = gltf.images.length;
  gltf.images.push({ name, bufferView, mimeType: "image/png" });
  const texture = gltf.textures.length;
  gltf.textures.push({ name, sampler, source: image });
  return texture;
}

function getRepeatSampler(gltf) {
  const existing = gltf.samplers.findIndex(sampler =>
    sampler.magFilter === 9729 &&
    sampler.minFilter === 9987 &&
    sampler.wrapS === 10497 &&
    sampler.wrapT === 10497
  );
  if (existing >= 0) return existing;
  gltf.samplers.push({
    magFilter: 9729,
    minFilter: 9987,
    wrapS: 10497,
    wrapT: 10497
  });
  return gltf.samplers.length - 1;
}

function addMaterial(context, options) {
  context.gltf.materials = context.gltf.materials || [];
  const index = context.gltf.materials.length;
  context.gltf.materials.push({});
  setMaterial(context.gltf.materials[index], options);
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

function bakePlanarUvs(context, primitive) {
  const positions = readAccessorVec3(context, primitive.attributes.POSITION);
  primitive.attributes.TEXCOORD_0 = writeUvAccessor(context, wearUvs(positions));
}

function readAccessorVec3(context, accessorIndex) {
  const accessor = context.gltf.accessors[accessorIndex];
  const bufferView = context.gltf.bufferViews[accessor.bufferView];
  const components = TYPE_COUNT[accessor.type];
  const componentSize = COMPONENT_SIZE[accessor.componentType];
  const stride = bufferView.byteStride || components * componentSize;
  const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
  const values = [];
  if (accessor.componentType !== 5126 || accessor.type !== "VEC3") {
    throw new Error(`POSITION accessor ${accessorIndex} must be FLOAT VEC3.`);
  }
  for (let i = 0; i < accessor.count; i += 1) {
    const base = byteOffset + i * stride;
    values.push(
      context.binary.readFloatLE(base),
      context.binary.readFloatLE(base + componentSize),
      context.binary.readFloatLE(base + componentSize * 2)
    );
  }
  return values;
}

function writeUvAccessor(context, values) {
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
  return addAccessor(context, buffer, values.length / 2, [minU, minV], [maxU, maxV]);
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

function createBrushedAluminumTextures(size) {
  const albedo = rgbaImage(size, size);
  const normal = rgbaImage(size, size);
  const heights = new Float32Array(size * size);
  const scuffs = createRandomMetalScuffs(size, 18, 20260707);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warp = (fbmNoise(x * 0.009, y * 0.014, 401, 4) - 0.5) * 34;
      const broadTone = fbmNoise(x * 0.004, y * 0.004, 409, 5) - 0.5;
      const longBrush = fbmNoise((x + warp) * 0.035, (y + warp * 0.2) * 0.92, 419, 4) - 0.5;
      const fineBrush = Math.sin((y + warp) * 2.9 + fbmNoise(x * 0.03, y * 0.1, 431, 3) * 3.4) * 0.5 + 0.5;
      const hairline = smoothStep(0.62, 0.94, fbmNoise((x + warp) * 0.08, y * 1.85, 443, 3));
      const micro = hashNoise(x, y, 457) - 0.5;
      const scuff = metalScuffAt(x, y, scuffs);
      const brushGroove = (fineBrush - 0.5) * 0.025 + longBrush * 0.04 + hairline * 0.025;
      const height = 0.5 + broadTone * 0.018 + brushGroove + micro * 0.004 + scuff.height * 0.025;
      const i = y * size + x;
      heights[i] = height;

      const shade = clamp(178 + broadTone * 24 + longBrush * 22 + fineBrush * 10 + micro * 5 + scuff.albedo * 18, 138, 222);
      const p = i * 4;
      albedo.data[p] = clamp(shade * 1.01, 0, 255);
      albedo.data[p + 1] = clamp(shade, 0, 255);
      albedo.data[p + 2] = clamp(shade * 0.95, 0, 255);
      albedo.data[p + 3] = 255;
    }
  }

  fillNormalTexture(normal, heights, size, 0.5, 1.7);
  return { albedo, normal };
}

function createRandomizedBrushedAluminumTextures(size) {
  const albedo = rgbaImage(size, size);
  const normal = rgbaImage(size, size);
  const heights = new Float32Array(size * size);
  const scuffs = createRandomMetalScuffs(size, 10, 20260708);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warpX = (fbmNoise(x * 0.006, y * 0.008, 601, 5) - 0.5) * 82;
      const warpY = (fbmNoise(x * 0.008, y * 0.006, 607, 5) - 0.5) * 74;
      const localAngle = (fbmNoise(x * 0.0045, y * 0.0045, 613, 4) - 0.5) * 1.15;
      const ca = Math.cos(localAngle);
      const sa = Math.sin(localAngle);
      const wx = x + warpX;
      const wy = y + warpY;
      const u = wx * ca + wy * sa;
      const v = -wx * sa + wy * ca;

      const broadTone = fbmNoise(wx * 0.0038, wy * 0.0038, 619, 5) - 0.5;
      const cloudyWear = fbmNoise(wx * 0.014, wy * 0.011, 631, 4) - 0.5;
      const brokenMask = 0.36 + smoothStep(0.18, 0.86, fbmNoise(wx * 0.018, wy * 0.017, 641, 4)) * 0.64;
      const directionalGrain = fbmNoise(u * 0.13, v * 0.72, 653, 4) - 0.5;
      const fineGrain = fbmNoise(u * 0.31, v * 1.18, 659, 3) - 0.5;
      const crossGrain = fbmNoise((u + v * 0.35) * 0.048, (v - u * 0.22) * 0.21, 661, 3) - 0.5;
      const micro = hashNoise(x, y, 673) - 0.5;
      const scuff = metalScuffAt(x, y, scuffs);
      const grain = (directionalGrain * 0.028 + fineGrain * 0.011) * brokenMask + crossGrain * 0.014;
      const height = 0.5 + broadTone * 0.013 + cloudyWear * 0.012 + grain + micro * 0.0035 + scuff.height * 0.014;
      const i = y * size + x;
      heights[i] = height;

      const shade = clamp(
        185 +
        broadTone * 18 +
        cloudyWear * 13 +
        directionalGrain * brokenMask * 12 +
        fineGrain * 5 +
        crossGrain * 8 +
        micro * 3 +
        scuff.albedo * 8,
        152,
        224
      );
      const p = i * 4;
      albedo.data[p] = clamp(shade * 1.012, 0, 255);
      albedo.data[p + 1] = clamp(shade * 1.002, 0, 255);
      albedo.data[p + 2] = clamp(shade * 0.957, 0, 255);
      albedo.data[p + 3] = 255;
    }
  }

  fillNormalTexture(normal, heights, size, 0.72, 0.92);
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
