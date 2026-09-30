/** Vertical clearance between a region's topmost vertex and its chip. */
export const CHIP_GAP = 12
/** A chip's line height over its font size. */
export const CHIP_LINE = 1.25
/** The on-screen chip text size a fitted map must not fall below, in px. */
export const CHIP_FLOOR_PX = 10
/** The stage area a 1440x900 window leaves for the map once the editor and toolbar islands are reserved — the
 * scale the chip floor is judged at, since the layout cannot know the real viewport. */
export const REFERENCE_STAGE = { width: 1100, height: 820 }
