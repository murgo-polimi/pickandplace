"use strict";

function createIndustrialConcreteFloor(scene, options = {}) {
  const {
    name = "industrialConcreteFloor",
    widthMeters = 24,
    heightMeters = 24,
    unitsPerMeter = 1000,
    assetMeters = 24,
    subdivisions = 96,
    y = 0,
    albedoUrl = "./assets/industrial_concrete_floor_24m_2m.png",
    normalUrl = "./assets/industrial_concrete_floor_24m_2m_normal.png",
    bumpLevel = 0.03,
    specular = 0.06,
    specularPower = 34
  } = options;

  const ground = BABYLON.CreateGround(name, {
    width: widthMeters * unitsPerMeter,
    height: heightMeters * unitsPerMeter,
    subdivisions
  }, scene);
  ground.position.y = y;
  ground.receiveShadows = true;

  const material = new BABYLON.StandardMaterial(`${name}Material`, scene);
  const albedoTexture = new BABYLON.Texture(albedoUrl, scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);
  const normalTexture = new BABYLON.Texture(normalUrl, scene, false, false, BABYLON.Texture.TRILINEAR_SAMPLINGMODE);

  for (const texture of [albedoTexture, normalTexture]) {
    texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    texture.uScale = widthMeters / assetMeters;
    texture.vScale = heightMeters / assetMeters;
  }

  normalTexture.gammaSpace = false;
  normalTexture.level = bumpLevel;
  material.diffuseTexture = albedoTexture;
  material.bumpTexture = normalTexture;
  material.diffuseColor = new BABYLON.Color3(0.92, 0.9, 0.85);
  material.emissiveColor = new BABYLON.Color3(0.16, 0.16, 0.15);
  material.specularColor = new BABYLON.Color3(specular, specular, specular * 0.92);
  material.specularPower = specularPower;
  material.backFaceCulling = false;
  ground.material = material;

  return { ground, material, albedoTexture, normalTexture };
}

window.createIndustrialConcreteFloor = createIndustrialConcreteFloor;
