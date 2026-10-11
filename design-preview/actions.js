import { analysis } from './fixture.js';
import { boardBriefFromAnalysis,editBoardBrief } from '../src/lib/hamilton/board-brief';
export const saveAnalysis=async()=>({id:'preview-analysis'});
export const loadHamiltonNavigationInstitution=async()=>({id:'2',name:'Example Credit Union'});
export const setViewAsCustomer=async()=>{};
export async function saveBoardBrief({reportId,edits}){
 const report=reportId?editBoardBrief(JSON.parse(localStorage.getItem(reportId)),edits):boardBriefFromAnalysis(analysis,'preview-analysis',edits);
 localStorage.setItem('preview-report',JSON.stringify(report));return {success:true,reportId:'preview-report'};
}

export const createPeerSet=async()=>({success:false,error:"Peer group saving is outside this synthetic visual preview."});
