/** Synthetic geography for research acceptance; loopback database only. */
import { seedHamiltonFixtures, HOME, EXCLUDED, type FixtureDb } from "./fixtures";
export async function seedResearchFixtures(db: FixtureDb) {
  const bank = EXCLUDED.find(i => i.charter === "bank")!;
    await seedHamiltonFixtures(db);
    await db`INSERT INTO institution_branch_deposits (cert, year, branch_number, institution_id, county_fips, deposits)
      VALUES (9701015, 2026, 1, ${bank.id}, 12009, 1000), (9701015, 2026, 2, ${bank.id}, 12095, 2000)
      ON CONFLICT DO NOTHING`;
    await db`INSERT INTO credit_union_branches (charter, site_id, report_date, institution_id, address, city, state, zip)
      VALUES ('9701001', '1', '2026-06-30', ${HOME.id}, '1 Fixture Road', 'Melbourne', 'FL', '32901'),
             ('9701001', '2', '2026-06-30', ${HOME.id}, '2 Fixture Road', 'Orlando', 'FL', '32801'),
             ('9701001', 'old', '2025-12-31', ${HOME.id}, 'Old Fixture Road', 'Miami', 'FL', '33101')
      ON CONFLICT (charter, site_id) DO UPDATE SET report_date=EXCLUDED.report_date`;
    await db`INSERT INTO branch_census_tracts (branch_kind, branch_key, institution_id, address_hash, status, county_fips)
      SELECT 'credit_union', b.charter || ':' || b.site_id, b.institution_id,
             md5(concat_ws('|', upper(b.address), upper(b.city), upper(b.state), left(b.zip,5))), 'matched',
             CASE b.site_id WHEN '1' THEN '12009' ELSE '12095' END
        FROM credit_union_branches b WHERE b.charter='9701001' AND b.site_id <> 'old'
      ON CONFLICT (branch_kind, branch_key) DO UPDATE SET address_hash=EXCLUDED.address_hash, status=EXCLUDED.status`;
    await db`INSERT INTO demographics (geo_id, geo_type, geo_name, year, total_population, median_household_income)
      VALUES ('county:12009', 'county', 'Synthetic County A', 2024, 100, 50000),
             ('county:12095', 'county', 'Synthetic County B', 2024, 300, 90000)
      ON CONFLICT (geo_id, geo_type, year) DO UPDATE SET total_population=EXCLUDED.total_population`;
}
