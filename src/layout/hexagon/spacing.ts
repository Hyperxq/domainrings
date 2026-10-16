/** Room kept between neighbouring boxes and between a box and the ring edge it hangs from. */
export const GAP = 14
/** The room an arrow keeps clear of the end of a wall. */
export const LANE = 12
/** Distance between parallel tracks sharing a corridor, and between threads entering one box face. */
export const TRACK_GAP = 8
export const OUTSIDE_GAP = 20
export const LABEL_PAD_X = 8
export const USE_CASE_TEXT_WIDTH = 160

/** More threads than this on one box collapse into a "+N" count. */
export const MAX_DOTS = 4
export const DOT_RADIUS = 4
export const DOT_STEP = 11
/** How far the first thread dot sits in from the box's right edge: clear of the rounded corner. */
export const DOT_INSET = 10
/** The extra room the first dot leaves for a note marker in the same corner. */
export const NOTE_CLEAR = 8
const MORE_WIDTH = 16

/** How far from a box's edge its `count` thread dots (and a note marker, and the "+N" past MAX_DOTS) reach. */
export const dotsReach = (count: number) => DOT_INSET + NOTE_CLEAR + (Math.min(count, MAX_DOTS) - 1) * DOT_STEP + DOT_RADIUS + (count > MAX_DOTS ? MORE_WIDTH : 0)
