/**
 * How long exhibits fold. A leaf module with no imports, so the homepage excerpt (at-a-glance)
 * can use it without pulling in the report's statistics or county map data.
 */

/** Rows each long exhibit shows before "Show all". */
export const ROWS_SHOWN = 5;

/** Classes for a row past the first ROWS_SHOWN inside <ShowAll>: hidden until opened, always printed. */
export const EXTRA_ROW = "hidden group-data-[open=true]/all:table-row print:table-row";
export const EXTRA_BLOCK_ROW = "hidden group-data-[open=true]/all:block print:block";
