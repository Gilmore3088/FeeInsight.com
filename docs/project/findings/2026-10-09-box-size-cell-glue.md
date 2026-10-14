# A safe deposit box size in the next column became a fee's price (Oct 9, 2026)

Institution 8414's fee schedule (doc 20570) prints its safe deposit box table beside the fee table. The
stored text joins them: "Return Item Fee | 03 x 10….....$45". Knox read the box rent, $45, as the
return item fee (73956, NSF). The category guard took it down at 07:31. UAT confirmed the takedown.

Fix, Knox v63 (`withBoxSizeCellsSplit` in `knox/rules.ts`): a box-size cell with a price that follows
another fee's name starts its own line. The box rent then reads as a box rent, and the fee's own line
carries no price. A line whose own text is the box table's heading keeps its sizes, as in "Safe Deposit
Box Rental | 3 x 5 - $20.00".

Gates at v63:
- seven states 744 right / 42 wrong;
- Texas 511/14;
- CA 133/6.
All three are unchanged from v62.

Known gap. Two fees in the same document are still not read:
- The bank's return item fee is "$28 per item" for "checks deposited drawn on your account at another
  financial institution", a deposited-item return. Its price sits two lines below its name, under a
  wrapped description.
- NSF is "$28 per paid or returned item". It sits on a line glued to the transaction list.
Both need a reader for a price below a wrapped description. That is not in v63.
