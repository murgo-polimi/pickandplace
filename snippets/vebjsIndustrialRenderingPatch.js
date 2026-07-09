"use strict";

function resolveVebAssetUrl(scene, path) {
  if (!path || path.includes("://") || path.startsWith("/")) return path;
  const base = scene?.repo?.mod3d || "./";
  return new URL(path, base).href;
}

function applyVebIndustrialRendering(scene, options = {}) {
  const {
    floorWidthMeters = 24,
    floorHeightMeters = 24,
    floorAssetMeters = 24,
    unitsPerMeter = 1000,
    floorY = 0,
    albedoUrl = "assets/industrial_concrete_floor_24m_2m.png",
    normalUrl = "assets/industrial_concrete_floor_24m_2m_normal.png",
    bumpLevel = 0.03,
    specular = 0.06,
    specularPower = 34,
    exposure = 1,
    contrast = 1,
    environmentIntensity = 0.34
  } = options;

  const ground = scene.ground || scene.getMeshByName?.("ground");
  if (ground) {
    ground.position.y = floorY;
    ground.receiveShadows = true;

    const material = new BABYLON.StandardMaterial("industrialGroundMaterial", scene);
    const albedo = new BABYLON.Texture(resolveVebAssetUrl(scene, albedoUrl), scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    const normal = new BABYLON.Texture(resolveVebAssetUrl(scene, normalUrl), scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
    const uScale = floorWidthMeters / floorAssetMeters;
    const vScale = floorHeightMeters / floorAssetMeters;

    for (const texture of [albedo, normal]) {
      texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
      texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
      texture.uScale = uScale;
      texture.vScale = vScale;
    }

    normal.gammaSpace = false;
    normal.level = bumpLevel;
    material.diffuseTexture = albedo;
    material.bumpTexture = normal;
    material.diffuseColor = new BABYLON.Color3(0.92, 0.9, 0.85);
    material.emissiveColor = new BABYLON.Color3(0.16, 0.16, 0.15);
    material.specularColor = new BABYLON.Color3(specular, specular, specular * 0.92);
    material.specularPower = specularPower;
    material.backFaceCulling = false;
    ground.material = material;

    if (floorWidthMeters && floorHeightMeters && unitsPerMeter) {
      ground.scaling.setAll(1);
      const width = floorWidthMeters * unitsPerMeter;
      const height = floorHeightMeters * unitsPerMeter;
      const currentBounds = ground.getBoundingInfo().boundingBox;
      const currentWidth = Math.max(1e-6, currentBounds.maximum.x - currentBounds.minimum.x);
      const currentHeight = Math.max(1e-6, currentBounds.maximum.z - currentBounds.minimum.z);
      ground.scaling.x = width / currentWidth;
      ground.scaling.z = height / currentHeight;
    }
  }

  const image = scene.imageProcessingConfiguration;
  if (image) {
    image.toneMappingEnabled = false;
    image.exposure = exposure;
    image.contrast = contrast;
  }

  scene.settings = scene.settings || {};
  scene.settings.shadow = scene.settings.shadow || {};
  scene.settings.shadow.environmentIntensity = environmentIntensity;

  applyVebMaterialCorrections(scene, { fallbackEnvironmentIntensity: environmentIntensity });

  return ground;
}

function applyVebMaterialCorrections(scene, options = {}) {
  const {
    fallbackEnvironmentIntensity = 0.28,
    disableForcedSheen = true
  } = options;

  for (const material of scene.materials || []) {
    if (material.getClassName?.() !== "PBRMaterial") continue;

    const profile = vebMaterialProfile(material.name || material.id || "", fallbackEnvironmentIntensity);
    material.usePhysicalLightFalloff = false;
    material.environmentIntensity = profile.environmentIntensity;

    if (disableForcedSheen && material.sheen) {
      material.sheen.isEnabled = false;
      material.sheen.intensity = 0;
    }

    if ("microSurface" in material && profile.microSurface !== undefined) {
      material.microSurface = profile.microSurface;
    }
    if ("specularIntensity" in material && profile.specularIntensity !== undefined) {
      material.specularIntensity = profile.specularIntensity;
    }
  }
}

function vebMaterialProfile(name, fallbackEnvironmentIntensity) {
  if (/rubber|belt/i.test(name)) {
    return {
      environmentIntensity: 0.18,
      microSurface: 0.18,
      specularIntensity: 0.12
    };
  }
  if (/matte red|red motor|motor cover/i.test(name) && /red/i.test(name)) {
    return {
      environmentIntensity: 0.18,
      microSurface: 0.16,
      specularIntensity: 0.12
    };
  }
  if (/darker motor|motor metal/i.test(name)) {
    return {
      environmentIntensity: 0.3,
      microSurface: 0.16
    };
  }
  if (/fastener|bolt|nut/i.test(name)) {
    return {
      environmentIntensity: 0.34,
      microSurface: 0.24
    };
  }
  if (/aluminum|steel|metal|brushed|satin/i.test(name)) {
    return {
      environmentIntensity: 0.34,
      microSurface: 0.2
    };
  }
  if (/polymer|plastic|support/i.test(name)) {
    return {
      environmentIntensity: 0.18,
      specularIntensity: 0.18
    };
  }
  return {
    environmentIntensity: fallbackEnvironmentIntensity
  };
}

window.applyVebIndustrialRendering = applyVebIndustrialRendering;
window.applyVebMaterialCorrections = applyVebMaterialCorrections;
