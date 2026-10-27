# Research snapshots must carry the shared fee comparison context

The research reader selected schedule keys and holding-company groups individually, omitting
the product-exception flag required by the shared statistics contract. A named account or wire
channel price could therefore influence a general benchmark. Replaying the October 26 drafts
after the statistics method changed also correctly rejected the old method version.

The reader now selects `STATS_SCHEDULE_KEYS`, including `product_exception`, as one shared
contract. A real-database regression renames a fixture fee as an online outgoing wire and checks
that the frozen input classifies it as an exception. The three editorial drafts are refreshed
from new read-only captures, rather than relabeling old calculations with a new method version.

**Guard:** `src/lib/research-database/research.db.test.ts` carries the shared product-exception
classification into frozen fee evidence. Snapshot replay verifies the method and calculation
hash before a draft can be approved.
