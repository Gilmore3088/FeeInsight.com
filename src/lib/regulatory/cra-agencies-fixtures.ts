/** Live-shaped fixtures for ./cra-agencies (read 2026-11-02). */

/** Two rows as CRAPES returned them on 2026-11-02 (getSearchResults, 2026-10 window). */
export const CRAPES_ROWS = [
  {
    ORG_CERT_NUM: 23091, EXM_CRA_PUB_DTE: "10/01/2026", INST_FIN_LGL_NME: "Alpine Bank", LOCN_PHY_CTY_NME: "GLENWOOD SPRINGS",
    LOCN_ST_ABBV_NME: "CO", INST_FIN_ACTV_FLG: "Y", EXM_INST_ASET_AMT: "$6,850,257.00", EXM_RTG_FULL_DESC: "Outstanding",
    EXM_ACT_PROC_DESC: "Large Bank Evaluation", SYS_EXTRN_FILE_ID: "2026/23091_260427.PDF", SYS_EXTRN_INET_ADDR: null,
    LOCN_PHY_POST_CDE: "81601", LOCN_PHY_LNE1_TXT: "2200 GRAND AVE", RATING_POINTS: 21, LENDING_RATING: "High Satisfactory",
    INVEST_RATING: "Outstanding", SERVICE_RATING: "Outstanding", row_num: 23,
  },
  { ORG_CERT_NUM: 57626, EXM_CRA_PUB_DTE: "10/01/2026", INST_FIN_LGL_NME: "1st State Bank", EXM_RTG_FULL_DESC: null },
];

/** One CRAPubWeb result row and pager as the page printed them on 2026-11-02. */
export const FRB_PAGE = `<html><head><title>Community Reinvestment Act - Search</title></head><body><table>
<tr><th>Bank Name - RSSD ID Headquarters Location</th><th>Overall Rating</th></tr>
<tr>
            <td><a class="bankDetail" href="#" id="746223|20180205">1880 BANK&nbsp;-&nbsp;746223</a><br />CAMBRIDGE,&nbsp;MD</td>
            <td class="Rating">Satisfactory</td>
            <td class="ExamDate">Feb 05, 2018<br /><a class="PE" href="DownloadPDF/746223_20180205">Download PE</a> </td>
            <td class="PublicDate">Sep 06, 2018</td>
            <td class="Method">Int Small Bank</td>
            <td class="Assets">$354,590</td>
        </tr>
<tr>
            <td><a class="bankDetail" href="#" id="99|20240101">TEST BANK&nbsp;-&nbsp;99</a><br />DOVER,&nbsp;DE</td>
            <td class="Rating">Sub Non Compliance</td>
            <td class="ExamDate">Jan 01, 2024</td>
            <td class="PublicDate"></td>
            <td class="Method">Small Bank</td>
            <td class="Assets">n/a</td>
        </tr>
<tr class="footer"><td colspan="6">1 <a href="/apps/CRAPubWeb/CRA/BankRatingResult?SearchClick=T&amp;page=2">2</a> <a href="/apps/CRAPubWeb/CRA/BankRatingResult?SearchClick=T&amp;page=2">Next &gt;</a></td></tr>
</table></body></html>`;
