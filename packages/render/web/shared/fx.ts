// Copied from synty-sprite-generator packages/shared/src/fx.ts (P2, ali3b/sloponator#9): the one naming rule the
// render bundle needs (the rest lives in @slop/library's synty module, which the browser bundle does not import).

/**
 * Optional pieces Synty bundles into a combined character file next to the bodies (SM_Char_Attach_Male_Armor_01,
 * SM_Chr_Attach_Hair_03, capes, hoods…). They are not part of any one body: variant renders hide them, and the
 * library lists each one as its own attachment asset so `--with` can add it back.
 */
export function isBundledAttachment(name: string) {
  return /(^|_)Attach(_|$)/i.test(name);
}
