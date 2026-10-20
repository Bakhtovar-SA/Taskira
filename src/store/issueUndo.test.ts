import {afterEach,expect,test,vi} from "vitest";
import {emptyData,mapIssue} from "./mappers";
import {createIssueUndo} from "./issueUndo";
import {ApiError,issuesApi,type ServerIssue} from "../api";
import type {Data,Issue} from "../types";
import type {StoreCtx} from "./ctx";
import type {IssueCrudDeps} from "./issueCrud";
const at="2026-10-15T10:00:00.001Z",later="2026-10-15T10:00:00.002Z";
const dto=(id="i1",statusId="s1",stamp=later):ServerIssue=>({id,projectId:"p1",num:1,key:id,title:id,statusId,
 updatedAt:stamp,createdAt:at,assigneeIds:["u1"],labels:[],parentId:null,doneAt:null,description:"",typeId:"task",priorityId:"medium",
 reporterId:"u1",epicId:null,sprintId:null,rank:0,dueDate:null,archivedAt:null,complexity:null,color:null,tStart:null,tSpan:null});
const issue=(id="i1",statusId="s2",stamp=at):Issue=>mapIssue(dto(id,statusId,stamp));
function harness(items=[issue()]) {
 const dataRef:{current:Data}={current:{...emptyData(),issues:items,currentProjectId:"p1",workflow:{statuses:[],transitions:[{id:"reverse",from:"s2",to:"s1"}]}}};
 const ctx={dataRef,pid:()=>dataRef.current.currentProjectId,setData:vi.fn((update:Parameters<StoreCtx["setData"]>[0])=>{dataRef.current=typeof update === "function" ? update(dataRef.current) : update}),toast:vi.fn(),local:(ru:string)=>ru,sessionEpochRef:{current:0},requirePerm:vi.fn(()=>true),handleApiError:vi.fn()} satisfies Pick<StoreCtx,"dataRef"|"pid"|"setData"|"toast"|"local"|"sessionEpochRef"|"requirePerm"|"handleApiError">;
 const deps={bumpIssues:vi.fn(),setUi:vi.fn(),resolveIssue:vi.fn(async()=>null)} satisfies Pick<IssueCrudDeps,"bumpIssues"|"setUi"|"resolveIssue">;
 return {ctx,deps};
}
afterEach(()=>vi.restoreAllMocks());
test("server version is sent with reverse transition; success is consumed, no recursive action",async()=>{
 const {ctx,deps}=harness(),transition=vi.spyOn(issuesApi,"transition").mockResolvedValue(dto());
 const action=createIssueUndo(ctx,deps,[{issueId:"i1",statusId:"s1",updatedAt:at}])!;
 expect(await action.run()).toBe(true);expect(transition).toHaveBeenCalledWith("p1","i1","s1",null,at);
 expect(ctx.dataRef.current.issues[0].statusId).toBe("s1");expect(deps.bumpIssues).toHaveBeenCalledOnce();
 expect(ctx.toast.mock.calls.at(-1)).toHaveLength(2);
});
test("a missing reverse edge offers no action",()=>{
 const {ctx,deps}=harness();ctx.dataRef.current.workflow.transitions=[];
 expect(createIssueUndo(ctx,deps,[{issueId:"i1",statusId:"s1",updatedAt:at}])).toBeUndefined();
});
test("removal restoration sends only prior arrays and expected version",async()=>{
 const {ctx,deps}=harness(),patch=vi.spyOn(issuesApi,"patch").mockResolvedValue(dto());
 const action=createIssueUndo(ctx,deps,[{issueId:"i1",labels:["old"],assigneeIds:["u1","u2"],updatedAt:at}])!;
 await action.run();expect(patch).toHaveBeenCalledWith("p1","i1",{labels:["old"],assigneeIds:["u1","u2"],expectedUpdatedAt:at});
});
test("newer local revision and server conflict cannot overwrite another change",async()=>{
 const {ctx,deps}=harness([issue("i1","s2",later),issue("i2")]);
 const transition=vi.spyOn(issuesApi,"transition").mockRejectedValue(new ApiError(409,"CONFLICT","changed"));
 const action=createIssueUndo(ctx,deps,[{issueId:"i1",statusId:"s1",updatedAt:at},{issueId:"i2",statusId:"s1",updatedAt:at}])!;
 expect(await action.run()).toBe(true);expect(transition).toHaveBeenCalledTimes(1);expect(ctx.setData).not.toHaveBeenCalled();
});
test("a slower list refresh before bulk undo is safe: CAS checks the newer server token",async()=>{
 const {ctx,deps}=harness([issue("i1","s1","2026-10-15T10:00:00.000Z")]);
 const transition=vi.spyOn(issuesApi,"transition").mockResolvedValue(dto());
 const action=createIssueUndo(ctx,deps,[{issueId:"i1",statusId:"s1",currentStatusId:"s2",updatedAt:at}])!;
 await action.run();expect(transition).toHaveBeenCalledOnce();
});
test("partial undo retries only network failures and doesn't repeat successful mutations",async()=>{
 const {ctx,deps}=harness([issue("i1"),issue("i2")]);
 const transition=vi.spyOn(issuesApi,"transition").mockResolvedValueOnce(dto()).mockRejectedValueOnce(new ApiError(0,"NETWORK","offline")).mockResolvedValueOnce(dto("i2"));
 const action=createIssueUndo(ctx,deps,[{issueId:"i1",statusId:"s1",updatedAt:at},{issueId:"i2",statusId:"s1",updatedAt:at}])!;
 expect(await action.run()).toBe(false);expect(await action.run()).toBe(true);
 expect(transition.mock.calls.map(args=>args[1])).toEqual(["i1","i2","i2"]);
});
test.each(["project","session","permission"])("%s change prevents undo",async(kind)=>{
 const {ctx,deps}=harness(),transition=vi.spyOn(issuesApi,"transition");
 const action=createIssueUndo(ctx,deps,[{issueId:"i1",statusId:"s1",updatedAt:at}])!;
 if(kind==="project")ctx.dataRef.current.currentProjectId="p2";
 if(kind==="session")ctx.sessionEpochRef.current++;
 if(kind==="permission")ctx.requirePerm.mockReturnValue(false);
 expect(await action.run()).toBe(true);expect(transition).not.toHaveBeenCalled();
});
test("double activation is ignored and a session change during the request ignores its response",async()=>{
 const {ctx,deps}=harness();let resolve!:(dto:ServerIssue)=>void;
 vi.spyOn(issuesApi,"transition").mockImplementation(()=>new Promise(r=>{resolve=r}));
 const action=createIssueUndo(ctx,deps,[{issueId:"i1",statusId:"s1",updatedAt:at}])!;
 const first=action.run();expect(await action.run()).toBe(false);ctx.sessionEpochRef.current++;resolve(dto());
 expect(await first).toBe(true);expect(ctx.setData).not.toHaveBeenCalled();
});


test("a now-invalid assignee restoration is consumed instead of offered as a network retry",async()=>{
 const {ctx,deps}=harness();const patch=vi.spyOn(issuesApi,"patch").mockRejectedValue(new ApiError(400,"BAD_REQUEST","User is no longer a member"));
 const action=createIssueUndo(ctx,deps,[{issueId:"i1",assigneeIds:["removed-user"],updatedAt:at}])!;
 expect(await action.run()).toBe(true);expect(await action.run()).toBe(true);expect(patch).toHaveBeenCalledOnce();
 expect(ctx.setData).not.toHaveBeenCalled();expect(deps.bumpIssues).toHaveBeenCalledOnce();
});
