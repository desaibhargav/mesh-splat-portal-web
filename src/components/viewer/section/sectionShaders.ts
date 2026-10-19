import { Color, type StandardMaterial } from "playcanvas";

export const reverseFaceColor = new Color(0.55, 0.55, 0.55);

export const sectionDeclaration = {
  glsl: `uniform vec4 portalSectionPlane;
uniform float portalSectionEnabled;
bool portalSectionClipped(vec3 world) { return portalSectionEnabled > 0.5 && dot(portalSectionPlane, vec4(world, 1.0)) < 0.0; }`,
  wgsl: `uniform portalSectionPlane: vec4f;
uniform portalSectionEnabled: f32;
fn portalSectionClipped(world: vec3f) -> bool { return uniform.portalSectionEnabled > 0.5 && dot(uniform.portalSectionPlane, vec4f(world, 1.0)) < 0.0; }`
};

// The engine's user-main hook runs in forward, depth, shadow, and picker passes.
export function configureSectionMaterial(material: StandardMaterial, reverseFaces = true) {
  for (const language of ["glsl", "wgsl"] as const) {
    const chunks = material.shaderChunks[language];
    chunks.set("litUserDeclarationPS", `${chunks.get("litUserDeclarationPS") ?? ""}\n${sectionDeclaration[language]}`);
    chunks.set("litUserMainStartPS", `${chunks.get("litUserMainStartPS") ?? ""}\nif (portalSectionClipped(vPositionW)) { discard; }`);
    if (reverseFaces) {
      const facing = language === "glsl" ? "gl_FrontFacing" : "pcFrontFacing";
      const enabled = language === "glsl" ? "portalSectionEnabled" : "uniform.portalSectionEnabled";
      const output = language === "glsl" ? "gl_FragColor" : "output.color";
      const color = language === "glsl" ? "portalReverseColor" : "uniform.portalReverseColor";
      chunks.set("litUserDeclarationPS", `${chunks.get("litUserDeclarationPS")}\n${language === "glsl" ? "uniform vec3 portalReverseColor;" : "uniform portalReverseColor: vec3f;"}`);
      chunks.set("litUserMainEndPS", `${chunks.get("litUserMainEndPS") ?? ""}
#if !defined(PICK_PASS) && !defined(PREPASS_PASS) && !defined(SHADOW_PASS)
if (${enabled} > 0.5 && !${facing}) {
    ${language === "glsl" ? "float portalReverseShade = 1.0;" : "var portalReverseShade: f32 = 1.0;"}
    #ifdef LIT_NEEDS_NORMAL
        portalReverseShade = 0.65 + 0.35 * abs(dot(dVertexNormalW, dViewDirW));
    #endif
    ${output} = ${language === "glsl" ? "vec4" : "vec4f"}(${color} * portalReverseShade, ${output}.a);
}
#endif`);
    }
  }
  if (reverseFaces) material.setParameter("portalReverseColor", [reverseFaceColor.r, reverseFaceColor.g, reverseFaceColor.b]);
}

// A signed plane distance interpolates linearly across each splat billboard.
// Compute it at vertices, avoiding inverse matrices or world reconstruction per pixel.
export function splatSectionVertex(source: string, language: "glsl" | "wgsl"): string {
  if (language === "glsl") return `uniform mat4 matrix_viewInverse;
${sectionDeclaration.glsl}
varying float portalSectionDistance;\n${source}`.replace("gaussianUV = corner.uv;", `
    portalSectionDistance = 0.0;
    if (portalSectionEnabled > 0.5) {
        #if GSPLAT_2DGS
            vec3 portalWorld = (matrix_model * vec4(modelCorner, 1.0)).xyz;
        #else
            vec3 portalView = center.view + vec3(corner.offset.xy / vec2(matrix_projection[0][0], matrix_projection[1][1]), 0.0);
            vec3 portalWorld = (matrix_viewInverse * vec4(portalView, 1.0)).xyz;
        #endif
        portalSectionDistance = dot(portalSectionPlane, vec4(portalWorld, 1.0));
    }
    gaussianUV = corner.uv;`);
  return `uniform matrix_viewInverse: mat4x4f;
${sectionDeclaration.wgsl}
varying portalSectionDistance: f32;\n${source}`.replace("output.gaussianUV = corner.uv;", `
    output.portalSectionDistance = 0.0;
    if (uniform.portalSectionEnabled > 0.5) {
        #if GSPLAT_2DGS
            let portalWorld = (uniform.matrix_model * vec4f(modelCorner, 1.0)).xyz;
        #else
            let portalView = center.view + vec3f(corner.offset.xy / vec2f(uniform.matrix_projection[0][0], uniform.matrix_projection[1][1]), 0.0);
            let portalWorld = (uniform.matrix_viewInverse * vec4f(portalView, 1.0)).xyz;
        #endif
        output.portalSectionDistance = dot(uniform.portalSectionPlane, vec4f(portalWorld, 1.0));
    }
    output.gaussianUV = corner.uv;`);
}

export function splatSectionFragment(source: string, language: "glsl" | "wgsl"): string {
  return language === "glsl" ? `uniform float portalSectionEnabled; varying float portalSectionDistance;\n${source}`
    .replace("void main(void) {", "void main(void) {\nif (portalSectionEnabled > 0.5 && portalSectionDistance < 0.0) { discard; }") :
    `uniform portalSectionEnabled: f32; varying portalSectionDistance: f32;\n${source}`
      .replace("var output: FragmentOutput;", "var output: FragmentOutput;\nif (uniform.portalSectionEnabled > 0.5 && portalSectionDistance < 0.0) { discard; }");
}
