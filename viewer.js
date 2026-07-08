"use strict";

const MODEL_FALLBACKS = [
  "Conveyor.glb",
  "Pick_and_Place_Robot.glb",
  "CommandBox.glb",
  "Grid_Hole.glb"
];

const FLOOR_SIZE_METERS = 24;
const CONCRETE_SLAB_SIZE_METERS = 2;
const INDUSTRIAL_FLOOR_TEXTURE_SIZE = 2048;
const INDUSTRIAL_FLOOR_VERSION = "20260601-floor-fine-seams";
const MODEL_LIST_VERSION = "20260708-command-box-dark-controls";
const INDUSTRIAL_FLOOR_ALBEDO_URL = `./assets/industrial_concrete_floor_24m_2m.png?v=${INDUSTRIAL_FLOOR_VERSION}`;
const INDUSTRIAL_FLOOR_NORMAL_URL = `./assets/industrial_concrete_floor_24m_2m_normal.png?v=${INDUSTRIAL_FLOOR_VERSION}`;
const CONCRETE_SEAM_WIDTH_METERS = 0.005;
const CONCRETE_SEAM_DARKENING = 26;
const CONCRETE_SEAM_DEPTH = 0.042;

const PROFILE_SETTINGS = {
  factory: {
    exposure: 1,
    contrast: 1,
    environment: 1,
    shadows: true,
    ao: true,
    bloom: true,
    materialMode: "factory"
  },
  inspection: {
    exposure: 1.28,
    contrast: 1.05,
    environment: 1.35,
    shadows: true,
    ao: true,
    bloom: false,
    materialMode: "factory"
  },
  studio: {
    exposure: 1,
    contrast: 1,
    environment: 0.85,
    shadows: true,
    ao: false,
    bloom: false,
    materialMode: "studio"
  },
  original: {
    exposure: 1,
    contrast: 1,
    environment: 1,
    shadows: false,
    ao: false,
    bloom: false,
    materialMode: "original"
  }
};

const MATERIAL_RULES = [
  { test: /motor housing|motor metal cover|satin aluminum/i, type: "motor-metal" },
  { test: /matte red motor cover/i, type: "motor-red" },
  { test: /nut|bolt|fastener/i, type: "fastener" },
  { test: /rubber|belt/i, type: "rubber" },
  { test: /led|light|emergency|button|glass|translucent/i, type: "indicator" },
  { test: /rubber|black plastic|dark grey plastic|nylon|abs|plastic|paint|tough/i, type: "polymer" },
  { test: /chrome|stainless|steel|aluminum|brushed|satin|bead blasted|metal/i, type: "metal" },
  { test: /yellow|red|green|blue/i, type: "colored" }
];

const state = {
  scene: null,
  engine: null,
  camera: null,
  light: null,
  shadowGenerator: null,
  defaultPipeline: null,
  ssaoPipeline: null,
  glowLayer: null,
  floor: null,
  floorMaterial: null,
  skybox: null,
  currentContainer: null,
  currentRoot: null,
  originalStates: new Map(),
  materialTypes: new Map(),
  compareOriginal: false,
  activeModel: null,
  modelMeshes: [],
  sceneScale: 1,
  textureCache: new Map()
};

const dom = {};

window.addEventListener("DOMContentLoaded", start);

async function start() {
  bindDom();
  if (!window.BABYLON) {
    setStatus("Babylon.js could not be loaded from the CDN.");
    return;
  }

  await initScene();
  await loadModelList();
  wireControls();
  applyProfile("factory", true);
  await loadSelectedModel();
  state.engine.runRenderLoop(renderFrame);
  window.addEventListener("resize", () => state.engine.resize());
}

function bindDom() {
  for (const id of [
    "renderCanvas",
    "statusText",
    "metricsText",
    "modelTitle",
    "modelSelect",
    "profileSelect",
    "resetView",
    "enhanceMaterials",
    "shadowsEnabled",
    "aoEnabled",
    "bloomEnabled",
    "skyboxEnabled",
    "rotateEnabled",
    "exposure",
    "contrast",
    "environment",
    "floorTile",
    "floorBump",
    "floorRoughness",
    "exposureValue",
    "contrastValue",
    "environmentValue",
    "floorTileValue",
    "floorBumpValue",
    "floorRoughnessValue",
    "snapshot",
    "compareToggle",
    "materialList"
  ]) {
    dom[id] = document.getElementById(id);
  }
}

async function initScene() {
  state.engine = new BABYLON.Engine(dom.renderCanvas, true, {
    antialias: true,
    preserveDrawingBuffer: true,
    stencil: true,
    premultipliedAlpha: false
  });
  state.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));

  state.scene = new BABYLON.Scene(state.engine);
  state.scene.clearColor = new BABYLON.Color4(0.13, 0.14, 0.13, 1);
  state.scene.environmentIntensity = 1;

  state.camera = new BABYLON.ArcRotateCamera(
    "camera",
    BABYLON.Tools.ToRadians(42),
    BABYLON.Tools.ToRadians(62),
    6,
    BABYLON.Vector3.Zero(),
    state.scene
  );
  state.camera.attachControl(dom.renderCanvas, true);
  state.camera.minZ = 0.01;
  state.camera.wheelPrecision = 45;
  state.camera.panningSensibility = 120;
  state.camera.lowerRadiusLimit = 0.04;

  new BABYLON.HemisphericLight("softFill", new BABYLON.Vector3(0, 1, 0), state.scene).intensity = 0.78;
  state.light = new BABYLON.DirectionalLight("keyLight", new BABYLON.Vector3(-0.55, -1.0, -0.62), state.scene);
  state.light.position = new BABYLON.Vector3(8, 12, 7);
  state.light.intensity = 5.2;

  state.shadowGenerator = new BABYLON.ShadowGenerator(2048, state.light);
  state.shadowGenerator.usePercentageCloserFiltering = true;
  state.shadowGenerator.filteringQuality = BABYLON.ShadowGenerator.QUALITY_HIGH;
  state.shadowGenerator.bias = 0.00008;
  state.shadowGenerator.normalBias = 0.012;

  await initEnvironment();
  initFloor();
  initPipelines();
}

async function initEnvironment() {
  try {
    const env = BABYLON.CubeTexture.CreateFromPrefilteredData("./studio.env", state.scene);
    state.scene.environmentTexture = env;
    state.skybox = state.scene.createDefaultSkybox(env, true, 1000, 0.18);
    state.skybox.name = "studioSkybox";
    state.skybox.setEnabled(false);
  } catch (error) {
    console.warn("Environment texture could not be loaded.", error);
  }
}

function initFloor() {
  state.floor = BABYLON.CreateGround("concreteFloor", {
    width: FLOOR_SIZE_METERS,
    height: FLOOR_SIZE_METERS,
    subdivisions: 96
  }, state.scene);
  state.floor.receiveShadows = true;

  const mat = new BABYLON.StandardMaterial("concreteFloorMaterial", state.scene);
  mat.diffuseColor = new BABYLON.Color3(0.92, 0.9, 0.85);
  mat.emissiveColor = new BABYLON.Color3(0.16, 0.16, 0.15);
  mat.specularColor = new BABYLON.Color3(0.06, 0.06, 0.055);
  mat.backFaceCulling = false;
  state.floor.material = mat;
  state.floorMaterial = mat;
  loadIndustrialConcreteFloorTextures(mat);
  updateFloorTexture();
}

function initPipelines() {
  const image = state.scene.imageProcessingConfiguration;
  image.toneMappingEnabled = false;
  image.exposure = 1;
  image.contrast = 1;

  try {
    state.ssaoPipeline = new BABYLON.SSAO2RenderingPipeline("ssao", state.scene, {
      ssaoRatio: 0.5,
      blurRatio: 0.45
    }, [state.camera]);
    state.ssaoPipeline.radius = 0.42;
    state.ssaoPipeline.totalStrength = 0.22;
    state.ssaoPipeline.expensiveBlur = false;
  } catch (error) {
    console.warn("SSAO2 pipeline is unavailable.", error);
  }

  state.glowLayer = new BABYLON.GlowLayer("indicatorGlow", state.scene, {
    blurKernelSize: 42
  });
  state.glowLayer.intensity = 0.18;
}

async function loadModelList() {
  let models = MODEL_FALLBACKS;
  try {
    const response = await fetch(`./models.json?v=${MODEL_LIST_VERSION}`);
    models = await response.json();
  } catch (error) {
    console.warn("models.json could not be loaded.", error);
  }

  dom.modelSelect.replaceChildren();
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    option.textContent = model.replace(/\.glb$/i, "");
    dom.modelSelect.append(option);
  }

  const preferred = models.includes("Conveyor.glb") ? "Conveyor.glb" : models[0];
  dom.modelSelect.value = preferred;
}

function wireControls() {
  dom.modelSelect.addEventListener("change", loadSelectedModel);
  dom.profileSelect.addEventListener("change", () => applyProfile(dom.profileSelect.value, true));
  dom.resetView.addEventListener("click", () => frameCamera(true));
  dom.snapshot.addEventListener("click", saveSnapshot);
  dom.compareToggle.addEventListener("click", () => {
    state.compareOriginal = !state.compareOriginal;
    dom.compareToggle.setAttribute("aria-pressed", String(state.compareOriginal));
    dom.compareToggle.textContent = state.compareOriginal ? "Return Enhanced" : "Compare Original";
    applyMaterialMode();
  });

  for (const input of [
    dom.enhanceMaterials,
    dom.shadowsEnabled,
    dom.aoEnabled,
    dom.bloomEnabled,
    dom.skyboxEnabled,
    dom.exposure,
    dom.contrast,
    dom.environment,
    dom.floorTile,
    dom.floorBump,
    dom.floorRoughness
  ]) {
    input.addEventListener("input", applyLiveSettings);
  }
}

async function loadSelectedModel() {
  const model = dom.modelSelect.value;
  state.activeModel = model;
  setStatus(`Loading ${model}`);
  disposeCurrentModel();

  try {
    const modelUrl = `${model}?v=${MODEL_LIST_VERSION}`;
    const container = await BABYLON.SceneLoader.LoadAssetContainerAsync("./", modelUrl, state.scene);
    state.currentContainer = container;
    container.addAllToScene();

    state.currentRoot = new BABYLON.TransformNode("modelRoot", state.scene);
    for (const node of container.rootNodes) {
      if (node !== state.currentRoot && !node.parent) {
        node.parent = state.currentRoot;
      }
    }

    state.modelMeshes = container.meshes.filter(mesh => mesh !== state.floor && mesh.getTotalVertices() > 0);
    normalizeImportedScale();
    ensureMeshMaterials();
    if (!isBakedMaterialModel()) {
      applyConveyorMaterialSplits();
    }
    captureOriginalStates();
    applyMaterialMode();
    state.scene.render();
    setupShadows();
    frameCamera(false);
    renderMaterialList();
    dom.modelTitle.textContent = model.replace(/\.glb$/i, "");
    setStatus(`Loaded ${model}`);
  } catch (error) {
    console.error(error);
    setStatus(`Could not load ${model}`);
  }
}

function disposeCurrentModel() {
  if (state.currentContainer) {
    state.currentContainer.dispose();
  }
  if (state.currentRoot) {
    state.currentRoot.dispose();
  }
  state.currentContainer = null;
  state.currentRoot = null;
  state.originalStates.clear();
  state.materialTypes.clear();
  state.modelMeshes = [];
  state.sceneScale = 1;
}

function normalizeImportedScale() {
  if (!state.currentRoot || !state.modelMeshes.length) return;
  const bounds = worldBounds(state.modelMeshes);
  const size = bounds.max.subtract(bounds.min);
  const maxDimension = Math.max(size.x, size.y, size.z);
  state.sceneScale = maxDimension > 100 ? 0.001 : 1;
  state.currentRoot.scaling.setAll(state.sceneScale);
  state.currentRoot.computeWorldMatrix(true);
  for (const mesh of state.modelMeshes) {
    mesh.computeWorldMatrix(true);
  }
}

function ensureMeshMaterials() {
  for (const mesh of state.modelMeshes) {
    if (!mesh.material) {
      const mat = new BABYLON.PBRMaterial(`${mesh.name || "mesh"} material`, state.scene);
      mat.albedoColor = new BABYLON.Color3(0.48, 0.5, 0.48);
      mat.metallic = 0;
      mat.roughness = 0.72;
      mesh.material = mat;
    }
  }
}

function applyConveyorMaterialSplits() {
  if (!/conveyor/i.test(state.activeModel || "")) return;
  const splitMaterials = new Map();

  for (const mesh of state.modelMeshes) {
    if (isConveyorRubberBelt(mesh)) {
      const source = mesh.material;
      if (!source) continue;
      const clone = source.clone(`${source.name || "Black Plastic"} Rubber Belt`);
      clone.name = `${source.name || "Black Plastic"} Rubber Belt`;
      mesh.material = clone;
      applyPlanarBeltUvs(mesh);
    } else if (isConveyorMotorHousing(mesh)) {
      mesh.material = conveyorMaterialVariant(splitMaterials, mesh.material, "Darker Motor Metal Cover");
      applyPlanarWearUvs(mesh);
    } else if (isConveyorMotorFastener(mesh)) {
      mesh.material = conveyorMaterialVariant(splitMaterials, mesh.material, "Dark Steel Motor Fasteners");
      applyPlanarWearUvs(mesh);
    } else if (isConveyorRedMotorCover(mesh)) {
      mesh.material = conveyorMaterialVariant(splitMaterials, mesh.material, "Matte Red Motor Cover");
    } else if (isConveyorSatinMetal(mesh)) {
      applyPlanarWearUvs(mesh);
    }
  }
}

function isBakedMaterialModel() {
  if (/_baked\.glb$/i.test(state.activeModel || "")) return true;
  return state.modelMeshes.some(mesh => /^Baked\s/i.test(mesh.material?.name || ""));
}

function conveyorMaterialVariant(cache, source, name) {
  if (!source) return source;
  if (!cache.has(name)) {
    const clone = source.clone(name);
    clone.name = name;
    cache.set(name, clone);
  }
  return cache.get(name);
}

function isConveyorRubberBelt(mesh) {
  const materialName = mesh.material?.name || "";
  if (!/basic black plastic/i.test(materialName)) return false;

  const box = mesh.getBoundingInfo().boundingBox;
  const size = box.maximum.subtract(box.minimum).scale(state.sceneScale);
  const longest = Math.max(size.x, size.y, size.z);
  const thinnest = Math.min(size.x, size.y, size.z);

  return size.y === thinnest && size.x > size.z * 2 && longest / Math.max(thinnest, 0.001) > 90;
}

function isConveyorSatinMetal(mesh) {
  return /matte steel|steel|aluminum/i.test(mesh.material?.name || "");
}

function isConveyorMotorHousing(mesh) {
  return /matte steel\.024/i.test(mesh.material?.name || "") && /mesh_5\.001$/i.test(mesh.name || "");
}

function isConveyorMotorFastener(mesh) {
  return /matte steel\.024/i.test(mesh.material?.name || "") && /mesh_(11|12)$/i.test(mesh.name || "");
}

function isConveyorRedMotorCover(mesh) {
  return /basic red light plastic/i.test(mesh.material?.name || "") && /mesh_9\.001$/i.test(mesh.name || "");
}

function applyPlanarBeltUvs(mesh) {
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  if (!positions) return;

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
    const u = ((positions[i] - min.x) / width) * 8;
    const v = ((positions[i + 2] - min.z) / depth) * 2.4;
    uvs.push(u, v);
  }

  mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs, false);
}

function applyPlanarWearUvs(mesh) {
  const positions = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  if (!positions) return;

  const axes = [
    { key: "x", index: 0, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    { key: "y", index: 1, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    { key: "z", index: 2, min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY }
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
    const u = ((positions[i + uAxis.index] - uAxis.min) / uAxis.size) * uRepeat;
    const v = ((positions[i + vAxis.index] - vAxis.min) / vAxis.size) * vRepeat;
    uvs.push(u, v);
  }

  mesh.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs, false);
}

function captureOriginalStates() {
  const materials = uniqueMaterials();
  for (const mat of materials) {
    const type = classifyMaterial(mat.name || "", mat.albedoColor);
    state.materialTypes.set(mat, type);
    state.originalStates.set(mat, {
      alpha: mat.alpha,
      metallic: "metallic" in mat ? mat.metallic : null,
      roughness: "roughness" in mat ? mat.roughness : null,
      albedoColor: mat.albedoColor ? mat.albedoColor.clone() : null,
      albedoTexture: "albedoTexture" in mat ? mat.albedoTexture : null,
      bumpTexture: "bumpTexture" in mat ? mat.bumpTexture : null,
      bumpLevel: mat.bumpTexture ? mat.bumpTexture.level : null,
      emissiveColor: mat.emissiveColor ? mat.emissiveColor.clone() : null,
      environmentIntensity: "environmentIntensity" in mat ? mat.environmentIntensity : null,
      transparencyMode: "transparencyMode" in mat ? mat.transparencyMode : null,
      needDepthPrePass: "needDepthPrePass" in mat ? mat.needDepthPrePass : null
    });
  }
}

function uniqueMaterials() {
  return [...new Set(state.modelMeshes.map(mesh => mesh.material).filter(Boolean))];
}

function classifyMaterial(name, color) {
  const rule = MATERIAL_RULES.find(entry => entry.test.test(name));
  if (rule) return rule.type;
  if (color) {
    const max = Math.max(color.r, color.g, color.b);
    const min = Math.min(color.r, color.g, color.b);
    if (max > 0.25 && max - min > 0.24) {
      return "colored";
    }
  }
  return "neutral";
}

function applyProfile(profileName, syncControls) {
  const profile = PROFILE_SETTINGS[profileName] || PROFILE_SETTINGS.factory;
  if (syncControls) {
    dom.exposure.value = profile.exposure;
    dom.contrast.value = profile.contrast;
    dom.environment.value = profile.environment;
    dom.shadowsEnabled.checked = profile.shadows;
    dom.aoEnabled.checked = profile.ao;
    dom.bloomEnabled.checked = profile.bloom;
    dom.enhanceMaterials.checked = profile.materialMode !== "original";
  }
  applyLiveSettings();
}

function applyLiveSettings() {
  const image = state.scene.imageProcessingConfiguration;
  image.exposure = numberValue(dom.exposure);
  image.contrast = numberValue(dom.contrast);
  state.scene.environmentIntensity = numberValue(dom.environment);
  state.light.intensity = dom.profileSelect.value === "inspection" ? 7.2 : 5.2;

  if (state.defaultPipeline) {
    state.defaultPipeline.bloomEnabled = dom.bloomEnabled.checked;
  }
  if (state.ssaoPipeline) {
    state.ssaoPipeline.isEnabled = dom.aoEnabled.checked;
  }
  if (state.glowLayer) {
    state.glowLayer.intensity = dom.bloomEnabled.checked ? 0.18 : 0.06;
  }
  if (state.skybox) {
    state.skybox.setEnabled(dom.skyboxEnabled.checked);
  }

  updateFloorTexture();
  setupShadows();
  applyMaterialMode();
  updateSliderText();
}

function updateSliderText() {
  dom.exposureValue.textContent = numberValue(dom.exposure).toFixed(2);
  dom.contrastValue.textContent = numberValue(dom.contrast).toFixed(2);
  dom.environmentValue.textContent = numberValue(dom.environment).toFixed(2);
  dom.floorTileValue.textContent = String(Math.round(numberValue(dom.floorTile)));
  dom.floorBumpValue.textContent = numberValue(dom.floorBump).toFixed(2);
  dom.floorRoughnessValue.textContent = numberValue(dom.floorRoughness).toFixed(2);
}

function updateFloorTexture() {
  if (!state.floorMaterial) return;
  const scale = numberValue(dom.floorTile);
  const usesIndustrialFloorTexture = Boolean(state.floorMaterial.diffuseTexture?.metadata?.industrialFloor);
  const textureScale = usesIndustrialFloorTexture ? 1 : scale;
  for (const texture of [state.floorMaterial.diffuseTexture, state.floorMaterial.bumpTexture]) {
    if (texture) {
      texture.uScale = textureScale;
      texture.vScale = textureScale;
    }
  }
  if ("roughness" in state.floorMaterial) {
    state.floorMaterial.roughness = numberValue(dom.floorRoughness);
  } else if ("specularPower" in state.floorMaterial) {
    const roughness = numberValue(dom.floorRoughness);
    const gloss = 1 - roughness;
    state.floorMaterial.specularPower = 12 + gloss * 80;
    const specular = 0.035 + gloss * 0.12;
    state.floorMaterial.specularColor = new BABYLON.Color3(specular, specular, specular * 0.95);
  }
  if (state.floorMaterial.bumpTexture) {
    state.floorMaterial.bumpTexture.level = numberValue(dom.floorBump);
  }
}

function loadIndustrialConcreteFloorTextures(material) {
  const albedoTexture = new BABYLON.Texture(
    INDUSTRIAL_FLOOR_ALBEDO_URL,
    state.scene,
    false,
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  const normalTexture = new BABYLON.Texture(
    INDUSTRIAL_FLOOR_NORMAL_URL,
    state.scene,
    false,
    false,
    BABYLON.Texture.TRILINEAR_SAMPLINGMODE
  );
  albedoTexture.metadata = { industrialFloor: true };
  normalTexture.metadata = { industrialFloor: true };
  normalTexture.gammaSpace = false;
  configureGeneratedTextures(albedoTexture, normalTexture);
  material.diffuseTexture = albedoTexture;
  material.bumpTexture = normalTexture;
  updateFloorTexture();
}

function generateIndustrialConcreteFloorTextures(material) {
  const image = new Image();
  image.onload = () => {
    const sourceSize = 1024;
    const source = document.createElement("canvas");
    source.width = sourceSize;
    source.height = sourceSize;

    const sourceCtx = source.getContext("2d");
    sourceCtx.drawImage(image, 0, 0, sourceSize, sourceSize);

    const sourceData = sourceCtx.getImageData(0, 0, sourceSize, sourceSize);
    const size = INDUSTRIAL_FLOOR_TEXTURE_SIZE;
    const slabCount = Math.max(1, Math.round(FLOOR_SIZE_METERS / CONCRETE_SLAB_SIZE_METERS));
    const slabPixelSize = size / slabCount;
    const variants = createConcreteSlabVariants(slabCount);
    const albedoTexture = new BABYLON.DynamicTexture("Generated industrial concrete floor albedo", {
      width: size,
      height: size
    }, state.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    const normalTexture = new BABYLON.DynamicTexture("Generated industrial concrete floor normal", {
      width: size,
      height: size
    }, state.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    const albedoCtx = albedoTexture.getContext();
    const normalCtx = normalTexture.getContext();
    const albedo = albedoCtx.createImageData(size, size);
    const normal = normalCtx.createImageData(size, size);
    const heights = new Float32Array(size * size);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const slabXf = ((x + 0.5) / size) * slabCount;
        const slabYf = ((y + 0.5) / size) * slabCount;
        const slabX = Math.min(slabCount - 1, Math.floor(slabXf));
        const slabY = Math.min(slabCount - 1, Math.floor(slabYf));
        const localU = slabXf - slabX;
        const localV = slabYf - slabY;
        const slab = variants[slabY * slabCount + slabX];
        const uv = transformConcreteSlabUv(localU, localV, slab);
        const sample = sampleConcreteSource(sourceData, sourceSize, uv.u, uv.v);
        const seamCore = concreteSawCutMask(x, y, slabPixelSize, slabCount);
        const slabWear = concreteSlabWear(localU, localV, slab, slabX, slabY);
        const grain = hashNoise(x, y, 601) - 0.5;
        const p = (y * size + x) * 4;
        const sourceLuminance = (sample.r * 0.2126 + sample.g * 0.7152 + sample.b * 0.0722) / 255;
        const sourceGrain = (sourceLuminance - 0.5) * 12;
        let r = 168 + sourceGrain + slabWear.albedo + slab.toneOffset;
        let g = 167 + sourceGrain + slabWear.albedo + slab.toneOffset;
        let b = 160 + sourceGrain + slabWear.albedo + slab.toneOffset * 0.7;
        const seamDarkening = seamCore * CONCRETE_SEAM_DARKENING;
        const surfaceNoise = grain * 3.2;
        r = BABYLON.Scalar.Clamp(r + surfaceNoise - seamDarkening, 0, 255);
        g = BABYLON.Scalar.Clamp(g + surfaceNoise - seamDarkening, 0, 255);
        b = BABYLON.Scalar.Clamp(b + surfaceNoise - seamDarkening, 0, 255);

        albedo.data[p] = r;
        albedo.data[p + 1] = g;
        albedo.data[p + 2] = b;
        albedo.data[p + 3] = 255;

        const luminance = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 255;
        heights[y * size + x] = luminance * 0.1 + grain * 0.008 + slabWear.height + slab.heightBias - seamCore * CONCRETE_SEAM_DEPTH;
      }
    }

    fillNormalTexture(normal, heights, size, 3.6, 3.6);
    albedoCtx.putImageData(albedo, 0, 0);
    normalCtx.putImageData(normal, 0, 0);
    albedoTexture.update(false);
    normalTexture.update(false);
    normalTexture.gammaSpace = false;
    albedoTexture.metadata = { industrialFloor: true };
    normalTexture.metadata = { industrialFloor: true };
    configureGeneratedTextures(albedoTexture, normalTexture);
    material.diffuseTexture = albedoTexture;
    material.bumpTexture = normalTexture;
    updateFloorTexture();
  };
  image.src = "./concrete_floor.jpg";
}

function createConcreteSlabVariants(slabCount) {
  const variants = [];
  for (let y = 0; y < slabCount; y += 1) {
    for (let x = 0; x < slabCount; x += 1) {
      const random = seededRandom(9109 + x * 47569 + y * 91757);
      variants.push({
        offsetU: random(),
        offsetV: random(),
        rotation: Math.floor(random() * 4),
        mirror: random() > 0.5,
        sampleScale: 0.72 + random() * 0.5,
        toneOffset: -1.8 + random() * 3.6,
        heightBias: -0.006 + random() * 0.012,
        wearSeedA: 1000 + random() * 9000,
        wearSeedB: 1000 + random() * 9000,
        wearAngleA: random() * Math.PI,
        wearAngleB: random() * Math.PI
      });
    }
  }
  return variants;
}

function transformConcreteSlabUv(u, v, slab) {
  let tu = slab.mirror ? 1 - u : u;
  let tv = v;
  if (slab.rotation === 1) {
    [tu, tv] = [tv, 1 - tu];
  } else if (slab.rotation === 2) {
    tu = 1 - tu;
    tv = 1 - tv;
  } else if (slab.rotation === 3) {
    [tu, tv] = [1 - tv, tu];
  }

  return {
    u: tu * slab.sampleScale + slab.offsetU,
    v: tv * slab.sampleScale + slab.offsetV
  };
}

function concreteSawCutMask(x, y, slabPixelSize, slabCount) {
  return Math.max(
    concreteSawCutLineMask(x, slabPixelSize, slabCount),
    concreteSawCutLineMask(y, slabPixelSize, slabCount)
  );
}

function concreteSawCutLineMask(pixel, slabPixelSize, slabCount) {
  const coordinate = pixel + 0.5;
  const boundary = Math.round(coordinate / slabPixelSize);
  if (boundary <= 0 || boundary >= slabCount) return 0;
  const boundaryPixel = boundary * slabPixelSize;
  const seamWidthPixels = Math.max(0.2, CONCRETE_SEAM_WIDTH_METERS * (slabPixelSize / CONCRETE_SLAB_SIZE_METERS));
  const halfWidth = seamWidthPixels * 0.5;
  const feather = halfWidth + 0.48;
  return 1 - smoothStep(halfWidth, feather, Math.abs(coordinate - boundaryPixel));
}

function sampleConcreteSource(sourceData, sourceSize, u, v) {
  const x = Math.floor(wrap01(u) * sourceSize) % sourceSize;
  const y = Math.floor(wrap01(v) * sourceSize) % sourceSize;
  const i = (y * sourceSize + x) * 4;
  return {
    r: sourceData.data[i],
    g: sourceData.data[i + 1],
    b: sourceData.data[i + 2]
  };
}

function wrap01(value) {
  return value - Math.floor(value);
}

function concreteSlabWear(localU, localV, slab, slabX, slabY) {
  const worldU = slabX + localU;
  const worldV = slabY + localV;
  const broad = fbmNoise(worldU * 0.72 + slab.wearSeedA, worldV * 0.72 - slab.wearSeedA, 811, 5) - 0.5;
  const softCloud = fbmNoise(worldU * 1.35 - slab.wearSeedB, worldV * 1.1 + slab.wearSeedB, 823, 4) - 0.5;
  const fineWear = fbmNoise(worldU * 9.5 + slab.wearSeedB, worldV * 8.5 - slab.wearSeedA, 839, 3) - 0.5;
  const lineA = orientedWear(localU, localV, slab.wearAngleA, slab.wearSeedA, 0.018, 0.55);
  const lineB = orientedWear(localU, localV, slab.wearAngleB, slab.wearSeedB, 0.012, 0.32);
  const smoothedFootprint = smoothStep(0.52, 0.86, fbmNoise(worldU * 2.7 + slab.wearSeedA, worldV * 2.35, 853, 5));
  const albedo = broad * 10 + softCloud * 6 + fineWear * 3 - lineA * 7 - lineB * 4 - smoothedFootprint * 4.2;
  const height = broad * 0.011 + softCloud * 0.006 + fineWear * 0.004 - lineA * 0.012 - lineB * 0.007;
  return { albedo, height };
}

function orientedWear(u, v, angle, seed, width, strength) {
  const centeredU = u - 0.5;
  const centeredV = v - 0.5;
  const along = centeredU * Math.cos(angle) + centeredV * Math.sin(angle);
  const across = -centeredU * Math.sin(angle) + centeredV * Math.cos(angle);
  const wandering = (fbmNoise(along * 5 + seed, across * 2 - seed, 859, 3) - 0.5) * 0.08;
  const line = 1 - smoothStep(width, width * 2.8, Math.abs(across + wandering));
  const broken = smoothStep(0.34, 0.78, fbmNoise(along * 6 + seed, across * 4 + seed, 863, 3));
  return line * broken * strength;
}

function setupShadows() {
  if (!state.shadowGenerator) return;
  const enabled = dom.shadowsEnabled.checked;
  state.shadowGenerator.getShadowMap().renderList = [];
  state.floor.receiveShadows = enabled;
  for (const mesh of state.modelMeshes) {
    mesh.receiveShadows = enabled;
    if (enabled) {
      state.shadowGenerator.addShadowCaster(mesh, true);
    }
  }
}

function applyMaterialMode() {
  if (!state.originalStates.size) return;
  if (isBakedMaterialModel()) {
    renderMaterialList();
    return;
  }
  const useOriginal = state.compareOriginal || !dom.enhanceMaterials.checked || dom.profileSelect.value === "original";
  for (const mat of uniqueMaterials()) {
    const type = state.materialTypes.get(mat) || classifyMaterial(mat.name || "", mat.albedoColor);
    restoreMaterial(mat);
    if (!useOriginal) {
      enhanceMaterial(mat);
    }
    if ("environmentIntensity" in mat && (useOriginal || !["rubber", "metal", "motor-metal", "fastener", "motor-red"].includes(type))) {
      mat.environmentIntensity = numberValue(dom.environment);
    }
  }
  renderMaterialList();
}

function restoreMaterial(mat) {
  const saved = state.originalStates.get(mat);
  if (!saved) return;
  mat.alpha = saved.alpha;
  if (saved.albedoColor && mat.albedoColor) mat.albedoColor.copyFrom(saved.albedoColor);
  if ("albedoTexture" in mat) mat.albedoTexture = saved.albedoTexture;
  if ("bumpTexture" in mat) mat.bumpTexture = saved.bumpTexture;
  if (saved.bumpLevel !== null && mat.bumpTexture) mat.bumpTexture.level = saved.bumpLevel;
  if (saved.emissiveColor && mat.emissiveColor) mat.emissiveColor.copyFrom(saved.emissiveColor);
  if (saved.metallic !== null && "metallic" in mat) mat.metallic = saved.metallic;
  if (saved.roughness !== null && "roughness" in mat) mat.roughness = saved.roughness;
  if (saved.environmentIntensity !== null && "environmentIntensity" in mat) mat.environmentIntensity = saved.environmentIntensity;
  if (saved.transparencyMode !== null && "transparencyMode" in mat) mat.transparencyMode = saved.transparencyMode;
  if (saved.needDepthPrePass !== null && "needDepthPrePass" in mat) mat.needDepthPrePass = saved.needDepthPrePass;
}

function enhanceMaterial(mat) {
  const type = state.materialTypes.get(mat) || classifyMaterial(mat.name || "", mat.albedoColor);
  mat.backFaceCulling = true;
  if ("forceIrradianceInFragment" in mat) mat.forceIrradianceInFragment = true;

  if (type === "rubber") {
    applyRubberBeltMaterial(mat);
  } else if (type === "motor-metal") {
    applyMotorMetalCoverMaterial(mat);
  } else if (type === "fastener") {
    applyFastenerMaterial(mat);
  } else if (type === "motor-red") {
    applyMotorRedMaterial(mat);
  } else if (type === "metal") {
    applySatinMetalMaterial(mat);
  } else if (type === "polymer") {
    setPbr(mat, { metallic: 0, roughness: 0.68 });
    slightlyDesaturate(mat, 0.96);
  } else if (type === "indicator") {
    setPbr(mat, { metallic: 0, roughness: 0.24 });
    addIndicatorGlow(mat);
  } else if (type === "colored") {
    setPbr(mat, { metallic: 0, roughness: 0.52 });
  } else {
    setPbr(mat, { metallic: 0.1, roughness: 0.62 });
  }
}

function applyRubberBeltMaterial(mat) {
  const textures = createRubberTextures();
  setPbr(mat, { metallic: 0, roughness: 0.91 });
  if (mat.albedoColor) {
    mat.albedoColor.copyFromFloats(0.88, 0.88, 0.84);
  }
  if ("environmentIntensity" in mat) mat.environmentIntensity = 0.18;
  if ("microSurface" in mat) mat.microSurface = 0.18;
  if ("specularIntensity" in mat) mat.specularIntensity = 0.12;
  mat.albedoTexture = textures.albedo;
  mat.bumpTexture = textures.normal;
  mat.bumpTexture.level = 0.2;
}

function applySatinMetalMaterial(mat) {
  const textures = createMotorAluminumTextures();
  setPbr(mat, { metallic: 0.92, roughness: dom.profileSelect.value === "studio" ? 0.66 : 0.78 });
  if ("environmentIntensity" in mat) mat.environmentIntensity = 0.36;
  if ("microSurface" in mat) mat.microSurface = 0.2;
  if (mat.albedoColor) {
    mat.albedoColor.copyFromFloats(0.82, 0.82, 0.78);
  }
  mat.albedoTexture = textures.albedo;
  mat.bumpTexture = textures.normal;
  mat.bumpTexture.level = 0.034;
}

function applyMotorMetalCoverMaterial(mat) {
  const textures = createSatinMetalWearTextures();
  setPbr(mat, { metallic: 0.86, roughness: dom.profileSelect.value === "studio" ? 0.72 : 0.84 });
  if ("environmentIntensity" in mat) mat.environmentIntensity = 0.3;
  if ("microSurface" in mat) mat.microSurface = 0.16;
  if (mat.albedoColor) {
    mat.albedoColor.copyFromFloats(0.62, 0.61, 0.57);
  }
  mat.albedoTexture = textures.albedo;
  mat.bumpTexture = textures.normal;
  mat.bumpTexture.level = 0.045;
}

function applyFastenerMaterial(mat) {
  const textures = createDarkFastenerTextures();
  setPbr(mat, { metallic: 0.9, roughness: dom.profileSelect.value === "studio" ? 0.58 : 0.66 });
  if ("environmentIntensity" in mat) mat.environmentIntensity = 0.34;
  if ("microSurface" in mat) mat.microSurface = 0.24;
  if (mat.albedoColor) {
    mat.albedoColor.copyFromFloats(0.34, 0.35, 0.33);
  }
  mat.albedoTexture = textures.albedo;
  mat.bumpTexture = textures.normal;
  mat.bumpTexture.level = 0.026;
}

function applyMotorRedMaterial(mat) {
  setPbr(mat, { metallic: 0, roughness: dom.profileSelect.value === "studio" ? 0.72 : 0.82 });
  if ("environmentIntensity" in mat) mat.environmentIntensity = 0.18;
  if ("microSurface" in mat) mat.microSurface = 0.16;
  if ("specularIntensity" in mat) mat.specularIntensity = 0.12;
  if (mat.albedoColor) {
    mat.albedoColor.copyFromFloats(0.86, 0.04, 0.035);
  }
  if (mat.emissiveColor) {
    mat.emissiveColor.copyFromFloats(0, 0, 0);
  }
  mat.albedoTexture = null;
  mat.bumpTexture = null;
}

function createSatinMetalWearTextures() {
  if (state.textureCache.has("satinMetalWear")) {
    return state.textureCache.get("satinMetalWear");
  }

  const size = 512;
  const albedoTexture = new BABYLON.DynamicTexture("Generated satin metal wear albedo", {
    width: size,
    height: size
  }, state.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  const normalTexture = new BABYLON.DynamicTexture("Generated satin metal wear normal", {
    width: size,
    height: size
  }, state.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  const albedoCtx = albedoTexture.getContext();
  const normalCtx = normalTexture.getContext();
  const albedo = albedoCtx.createImageData(size, size);
  const normal = normalCtx.createImageData(size, size);
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

      const shade = BABYLON.Scalar.Clamp(182 + wear * 76 + satinNoise * 8 + microGrain * 4, 154, 224);
      const p = i * 4;
      albedo.data[p] = shade;
      albedo.data[p + 1] = BABYLON.Scalar.Clamp(shade * 0.985, 0, 255);
      albedo.data[p + 2] = BABYLON.Scalar.Clamp(shade * 0.94, 0, 255);
      albedo.data[p + 3] = 255;
    }
  }

  const heightAt = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (heightAt(x - 1, y) - heightAt(x + 1, y)) * 0.9;
      const dy = (heightAt(x, y - 1) - heightAt(x, y + 1)) * 1.1;
      const dz = 1;
      const length = Math.hypot(dx, dy, dz) || 1;
      const p = (y * size + x) * 4;
      normal.data[p] = ((dx / length) * 0.5 + 0.5) * 255;
      normal.data[p + 1] = ((dy / length) * 0.5 + 0.5) * 255;
      normal.data[p + 2] = ((dz / length) * 0.5 + 0.5) * 255;
      normal.data[p + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedo, 0, 0);
  normalCtx.putImageData(normal, 0, 0);
  albedoTexture.update(false);
  normalTexture.update(false);
  normalTexture.gammaSpace = false;
  for (const texture of [albedoTexture, normalTexture]) {
    texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 8;
  }

  const textures = { albedo: albedoTexture, normal: normalTexture };
  state.textureCache.set("satinMetalWear", textures);
  return textures;
}

function createMotorAluminumTextures() {
  if (state.textureCache.has("motorAluminum")) {
    return state.textureCache.get("motorAluminum");
  }

  const size = 512;
  const albedoTexture = new BABYLON.DynamicTexture("Generated motor satin aluminum albedo", {
    width: size,
    height: size
  }, state.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  const normalTexture = new BABYLON.DynamicTexture("Generated motor satin aluminum normal", {
    width: size,
    height: size
  }, state.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  const albedoCtx = albedoTexture.getContext();
  const normalCtx = normalTexture.getContext();
  const albedo = albedoCtx.createImageData(size, size);
  const normal = normalCtx.createImageData(size, size);
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

      const shade = BABYLON.Scalar.Clamp(211 + wear * 70 + satin * 7 + micro * 3, 184, 244);
      const p = i * 4;
      albedo.data[p] = BABYLON.Scalar.Clamp(shade * 1.02, 0, 255);
      albedo.data[p + 1] = shade;
      albedo.data[p + 2] = BABYLON.Scalar.Clamp(shade * 0.95, 0, 255);
      albedo.data[p + 3] = 255;
    }
  }

  fillNormalTexture(normal, heights, size, 0.78, 0.9);
  albedoCtx.putImageData(albedo, 0, 0);
  normalCtx.putImageData(normal, 0, 0);
  albedoTexture.update(false);
  normalTexture.update(false);
  normalTexture.gammaSpace = false;
  configureGeneratedTextures(albedoTexture, normalTexture);

  const textures = { albedo: albedoTexture, normal: normalTexture };
  state.textureCache.set("motorAluminum", textures);
  return textures;
}

function createDarkFastenerTextures() {
  if (state.textureCache.has("darkFastener")) {
    return state.textureCache.get("darkFastener");
  }

  const size = 256;
  const albedoTexture = new BABYLON.DynamicTexture("Generated dark fastener albedo", {
    width: size,
    height: size
  }, state.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  const normalTexture = new BABYLON.DynamicTexture("Generated dark fastener normal", {
    width: size,
    height: size
  }, state.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  const albedoCtx = albedoTexture.getContext();
  const normalCtx = normalTexture.getContext();
  const albedo = albedoCtx.createImageData(size, size);
  const normal = normalCtx.createImageData(size, size);
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

      const shade = BABYLON.Scalar.Clamp(82 + mottle * 18 + satin * 10 + micro * 4 + scuff.albedo * 18, 56, 122);
      const p = i * 4;
      albedo.data[p] = shade;
      albedo.data[p + 1] = BABYLON.Scalar.Clamp(shade * 1.02, 0, 255);
      albedo.data[p + 2] = BABYLON.Scalar.Clamp(shade * 0.96, 0, 255);
      albedo.data[p + 3] = 255;
    }
  }

  fillNormalTexture(normal, heights, size, 0.75, 0.75);
  albedoCtx.putImageData(albedo, 0, 0);
  normalCtx.putImageData(normal, 0, 0);
  albedoTexture.update(false);
  normalTexture.update(false);
  normalTexture.gammaSpace = false;
  configureGeneratedTextures(albedoTexture, normalTexture);

  const textures = { albedo: albedoTexture, normal: normalTexture };
  state.textureCache.set("darkFastener", textures);
  return textures;
}

function configureGeneratedTextures(...textures) {
  for (const texture of textures) {
    texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 8;
  }
}

function fillNormalTexture(imageData, heights, size, xStrength, yStrength) {
  const heightAt = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (heightAt(x - 1, y) - heightAt(x + 1, y)) * xStrength;
      const dy = (heightAt(x, y - 1) - heightAt(x, y + 1)) * yStrength;
      const dz = 1;
      const length = Math.hypot(dx, dy, dz) || 1;
      const p = (y * size + x) * 4;
      imageData.data[p] = ((dx / length) * 0.5 + 0.5) * 255;
      imageData.data[p + 1] = ((dy / length) * 0.5 + 0.5) * 255;
      imageData.data[p + 2] = ((dz / length) * 0.5 + 0.5) * 255;
      imageData.data[p + 3] = 255;
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
    albedo: BABYLON.Scalar.Clamp(albedo, -1, 1),
    height: BABYLON.Scalar.Clamp(height, -1, 1)
  };
}

function createRubberTextures() {
  if (state.textureCache.has("rubber")) {
    return state.textureCache.get("rubber");
  }

  const size = 512;
  const albedoCanvas = document.createElement("canvas");
  const normalCanvas = document.createElement("canvas");
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  normalCanvas.width = size;
  normalCanvas.height = size;

  const albedoCtx = albedoCanvas.getContext("2d");
  const normalCtx = normalCanvas.getContext("2d");
  const albedo = albedoCtx.createImageData(size, size);
  const normal = normalCtx.createImageData(size, size);
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

      const shade = BABYLON.Scalar.Clamp(22 + height * 48 + lightScuffs * 140 + linearScars * 62 + fineRubberGrain * 10 + grain * 10, 14, 82);
      const p = i * 4;
      albedo.data[p] = shade;
      albedo.data[p + 1] = shade + 1;
      albedo.data[p + 2] = shade;
      albedo.data[p + 3] = 255;
    }
  }

  const heightAt = (x, y) => heights[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (heightAt(x - 1, y) - heightAt(x + 1, y)) * 2.2;
      const dy = (heightAt(x, y - 1) - heightAt(x, y + 1)) * 4.2;
      const dz = 1;
      const length = Math.hypot(dx, dy, dz) || 1;
      const p = (y * size + x) * 4;
      normal.data[p] = ((dx / length) * 0.5 + 0.5) * 255;
      normal.data[p + 1] = ((dy / length) * 0.5 + 0.5) * 255;
      normal.data[p + 2] = ((dz / length) * 0.5 + 0.5) * 255;
      normal.data[p + 3] = 255;
    }
  }

  albedoCtx.putImageData(albedo, 0, 0);
  normalCtx.putImageData(normal, 0, 0);

  const albedoTexture = new BABYLON.DynamicTexture("Generated rubber belt albedo", {
    width: size,
    height: size
  }, state.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  const normalTexture = new BABYLON.DynamicTexture("Generated rubber belt normal", {
    width: size,
    height: size
  }, state.scene, true, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  albedoTexture.getContext().putImageData(albedo, 0, 0);
  normalTexture.getContext().putImageData(normal, 0, 0);
  albedoTexture.update(false);
  normalTexture.update(false);
  albedoTexture.name = "Generated rubber belt albedo";
  normalTexture.name = "Generated rubber belt normal";
  normalTexture.gammaSpace = false;
  for (const texture of [albedoTexture, normalTexture]) {
    texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.anisotropicFilteringLevel = 8;
  }

  const textures = { albedo: albedoTexture, normal: normalTexture };
  state.textureCache.set("rubber", textures);
  return textures;
}

function setPbr(mat, values) {
  if ("metallic" in mat) mat.metallic = values.metallic;
  if ("roughness" in mat) mat.roughness = values.roughness;
}

function addIndicatorGlow(mat) {
  if (!mat.emissiveColor) return;
  const base = mat.albedoColor || BABYLON.Color3.White();
  mat.emissiveColor.copyFrom(base.scale(0.42));
  if (/glass|translucent/i.test(mat.name || "")) {
    mat.alpha = 0.78;
    if ("transparencyMode" in mat) mat.transparencyMode = BABYLON.PBRMaterial.PBRMATERIAL_ALPHABLEND;
    if ("needDepthPrePass" in mat) mat.needDepthPrePass = true;
  }
}

function slightlyDesaturate(mat, amount) {
  if (!mat.albedoColor) return;
  const c = mat.albedoColor;
  const gray = c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722;
  c.r = gray + (c.r - gray) * amount;
  c.g = gray + (c.g - gray) * amount;
  c.b = gray + (c.b - gray) * amount;
}

function frameCamera(animate) {
  const meshes = state.modelMeshes.filter(mesh => mesh.isEnabled() && mesh.getTotalVertices() > 0);
  if (!meshes.length) return;

  const minMax = worldBounds(meshes);
  const center = BABYLON.Vector3.Center(minMax.min, minMax.max);
  const size = minMax.max.subtract(minMax.min);
  const radius = Math.max(size.length() * 0.78, 0.35);
  const targetRadius = radius * 2.45;

  state.floor.position.y = minMax.min.y - Math.max(size.y * 0.015, 0.01);
  state.floor.scaling.setAll(Math.max(radius / 4, 1));
  state.light.position = center.add(new BABYLON.Vector3(radius * 1.6, radius * 2.8, radius * 1.8));

  if (animate) {
    BABYLON.Animation.CreateAndStartAnimation("camTarget", state.camera, "target", 45, 18, state.camera.target, center, 0);
    BABYLON.Animation.CreateAndStartAnimation("camRadius", state.camera, "radius", 45, 18, state.camera.radius, targetRadius, 0);
  } else {
    state.camera.target = center;
    state.camera.radius = targetRadius;
  }

  state.camera.alpha = BABYLON.Tools.ToRadians(42);
  state.camera.beta = BABYLON.Tools.ToRadians(62);
  state.camera.upperRadiusLimit = targetRadius * 8;
  state.camera.maxZ = Math.max(targetRadius * 8, 1000);
}

function worldBounds(meshes) {
  const min = new BABYLON.Vector3(Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
  const max = new BABYLON.Vector3(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);

  for (const mesh of meshes) {
    mesh.computeWorldMatrix(true);
    const box = mesh.getBoundingInfo().boundingBox;
    min.x = Math.min(min.x, box.minimumWorld.x);
    min.y = Math.min(min.y, box.minimumWorld.y);
    min.z = Math.min(min.z, box.minimumWorld.z);
    max.x = Math.max(max.x, box.maximumWorld.x);
    max.y = Math.max(max.y, box.maximumWorld.y);
    max.z = Math.max(max.z, box.maximumWorld.z);
  }

  return { min, max };
}

function renderMaterialList() {
  if (!dom.materialList) return;
  dom.materialList.replaceChildren();

  for (const mat of uniqueMaterials()) {
    const type = state.materialTypes.get(mat) || classifyMaterial(mat.name || "", mat.albedoColor);
    const li = document.createElement("li");
    const swatch = document.createElement("span");
    const wrap = document.createElement("span");
    const name = document.createElement("span");
    const meta = document.createElement("span");

    swatch.className = "swatch";
    swatch.style.background = colorToCss(mat.albedoColor);
    wrap.className = "material-wrap";
    name.className = "material-name";
    meta.className = "material-type";
    name.textContent = mat.name || "Unnamed material";
    meta.textContent = `${type} | m ${materialNumber(mat, "metallic")} | r ${materialNumber(mat, "roughness")}`;
    wrap.append(name, meta);
    li.append(swatch, wrap);
    dom.materialList.append(li);
  }
}

function renderFrame() {
  if (dom.rotateEnabled.checked && state.currentRoot) {
    state.currentRoot.rotation.y += state.engine.getDeltaTime() * 0.00022;
  }
  state.scene.render();
  updateMetrics();
}

function updateMetrics() {
  if (!state.scene) return;
  const fps = Math.round(state.engine.getFps());
  const vertices = state.modelMeshes.reduce((sum, mesh) => sum + mesh.getTotalVertices(), 0);
  dom.metricsText.textContent = `${fps} FPS | ${state.modelMeshes.length} meshes | ${vertices.toLocaleString()} vertices`;
}

function saveSnapshot() {
  BABYLON.Tools.CreateScreenshotUsingRenderTarget(state.engine, state.camera, {
    width: 1920,
    height: 1080
  }, data => {
    const link = document.createElement("a");
    link.href = data;
    link.download = `${state.activeModel || "render"}-render.png`;
    link.click();
  }, "image/png");
}

function colorToCss(color) {
  if (!color) return "#7b817a";
  const r = Math.round(BABYLON.Scalar.Clamp(color.r, 0, 1) * 255);
  const g = Math.round(BABYLON.Scalar.Clamp(color.g, 0, 1) * 255);
  const b = Math.round(BABYLON.Scalar.Clamp(color.b, 0, 1) * 255);
  return `rgb(${r}, ${g}, ${b})`;
}

function materialNumber(mat, key) {
  return key in mat && Number.isFinite(mat[key]) ? mat[key].toFixed(2) : "-";
}

function numberValue(input) {
  return Number.parseFloat(input.value);
}

function smoothStep(edge0, edge1, value) {
  const t = BABYLON.Scalar.Clamp((value - edge0) / (edge1 - edge0), 0, 1);
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
  const top = BABYLON.Scalar.Lerp(a, b, sx);
  const bottom = BABYLON.Scalar.Lerp(c, d, sx);
  return BABYLON.Scalar.Lerp(top, bottom, sy);
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

function setStatus(message) {
  dom.statusText.textContent = message;
}
