import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, FormEvent } from "react";
import { supabase } from "./supabase";
import type { Profile } from "./AuthGate";
import {
  LogOut, Users, CalendarDays, Download, RefreshCw, Phone, ChevronLeft,
  ChevronRight, Search, Printer, ClipboardList, Shield, HardDrive, Plus,
  Check, X, Pencil, Upload, FileDown, UserRound, CalendarCheck, Clock
} from "lucide-react";

type Employee = {
  id:string; employee_code:string; full_name:string; department:string|null;
  designation?:string|null; email?:string|null; phone:string|null;
  joining_date?:string|null; emergency_contact?:string|null; is_active:boolean;
};
type Attendance = { id?:string; employee_id:string; attendance_date:string; status:string; note?:string|null };
type DailyNote = { id:string; employee_id:string; note_date:string; note:string };
type OvertimeEntry = { id:string; employee_id:string; overtime_date:string; hours:number };
type Leave = {
  id:string; employee_id:string; leave_type:string; start_date:string; end_date:string;
  reason:string|null; status:string; created_at:string;
};
type Event = { id:string; event_date:string; event_type:string; title:string; notes:string|null };
type UserProfile = { user_id:string; organization_id:string; role:string; employee_id:string|null; display_name:string|null };
type BackupRow = { id:string; file_name:string; storage_path:string; file_size:number; created_at:string };
type AppDataCache = {version:number; savedAt:number; employees:Employee[]; attendance:Attendance[]; dailyNotes:DailyNote[]; overtimeEntries:OvertimeEntry[]; leaves:Leave[]; events:Event[]; users:UserProfile[]; backups:BackupRow[]};
function appCacheKey(userId:string,organizationId:string,year:number){return "shovonote:data-cache:v1:"+organizationId+":"+userId+":"+year;}
function readAppCache(userId:string,organizationId:string,year:number):AppDataCache|null{
  try{const raw=localStorage.getItem(appCacheKey(userId,organizationId,year));if(!raw)return null;const parsed=JSON.parse(raw) as AppDataCache;if(parsed.version!==1||!Array.isArray(parsed.employees)||!Array.isArray(parsed.attendance))return null;return parsed;}catch{return null;}
}

const STATUSES = ["P","P1","P2","A","C/L","C/L2","O/L","O/L2","S/L","H","L/O","W/O","L/L","H/L","OT","LL/2"];
const LABELS:Record<string,string> = {P:"Present · 8 Hours",P1:"Present + 1 Hour C/L",P2:"Present + 2 Hours C/L",A:"Absent","C/L":"Casual Leave","C/L2":"Half-day Casual Leave","O/L":"Official Leave","O/L2":"Half-day Official Leave","S/L":"Sick Leave",H:"Holiday","L/O":"Lay Off","W/O":"Weekly Off","L/L":"Compensatory Weekly Off (Friday Work Exchange)","H/L":"Half-day Leave",OT:"Legacy Overtime Code","LL/2":"Legacy Leave Code"};
const PRESENT_STATUSES = ["P","P1","P2"];
const DUTY_HOURS:Record<string,number> = {P:8,P1:7,P2:6,A:0,"C/L":0,"C/L2":4,"O/L":0,"O/L2":4,"S/L":0,H:0,"L/O":0,"W/O":0,"L/L":0,"H/L":4};
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEKDAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const weekday = (date:string) => WEEKDAYS[new Date(date+"T00:00:00").getDay()];
const dateKey = (d:Date) => d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
const today = () => dateKey(new Date());
const statusCodeLabel=(s:string)=>s==="O/L2"?"1/2 O/L":s==="C/L2"?"1/2 C/L":s;
const sortEmployees = (rows:Employee[]) => [...rows].sort((a,b)=>{
  const x=Number(a.employee_code),y=Number(b.employee_code);
  const xv=!!a.employee_code&&Number.isFinite(x),yv=!!b.employee_code&&Number.isFinite(y);
  if(xv&&yv)return x-y;if(xv)return -1;if(yv)return 1;
  return (a.employee_code||"").localeCompare(b.employee_code||"");
});
function downloadBlob(data:BlobPart,name:string,type="application/octet-stream"){
  const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement("a");
  a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
}
function csvDownload(rows:unknown[][],name:string){
  const csv="\ufeff"+rows.map(r=>r.map(v=>'"'+String(v??"").replaceAll('"','""')+'"').join(",")).join("\r\n");
  downloadBlob(csv,name,"text/csv;charset=utf-8");
}
function StatusSelect({value,onChange,disabled=false}:{value:string;onChange:(v:string)=>void;disabled?:boolean}){
  const optionLabel=(s:string)=>s==="O/L2"?"1/2 O/L — Half-day Official Leave":s==="C/L2"?"1/2 C/L — Half-day Casual Leave":`${s} — ${LABELS[s]}`;
  return <select className={"status "+(value?"st-"+value.replace("/","-"):"")} value={value} disabled={disabled}
    onChange={e=>onChange(e.target.value)}><option value="">Select status</option>{STATUSES.map(s=><option key={s} value={s}>{optionLabel(s)}</option>)}</select>;
}
function StatusDisplay({status,overtimeHours=0,tone=""}:{status:string;overtimeHours?:number;tone?:string}){
  const halfBase:Record<string,string>={"O/L2":"O/L","C/L2":"C/L","LL/2":"L/L"};
  if(halfBase[status])return <span className={"status-read half-status "+(tone?"tone-"+tone:"")}><span className="status-fraction"><span>1</span><span>2</span></span><b>{halfBase[status]}</b></span>;
  return <span className={"status-read "+(status?"day-"+status.replace("/","-"):"")+(tone?" tone-"+tone:"")}>{status||"—"}{status==="P"&&overtimeHours>0&&<small className="p-ot-subtext">{Number(overtimeHours).toLocaleString("en-US")}Hours</small>}</span>;
}
function Field({label,children}:{label:string;children:ReactNode}){
  return <label className="field"><span>{label}</span>{children}</label>;
}
export default function App({profile}:{profile:Profile}){
  const canManage=["owner","admin"].includes(profile.role);
  const canSeeAll=["owner","admin","viewer"].includes(profile.role);
  const [cacheSeed]=useState(()=>{try{const saved=localStorage.getItem("shovonote:last-month:"+profile.user_id);const cachedYear=saved?new Date(saved+"T00:00:00").getFullYear():new Date().getFullYear();return readAppCache(profile.user_id,profile.organization_id,cachedYear);}catch{return null;}});
  const [employees,setEmployees]=useState<Employee[]>(cacheSeed?.employees||[]);
  const [attendance,setAttendance]=useState<Attendance[]>(cacheSeed?.attendance||[]);
  const [dailyNotes,setDailyNotes]=useState<DailyNote[]>(cacheSeed?.dailyNotes||[]);
  const [draftDailyNotes,setDraftDailyNotes]=useState<Record<string,string>>({});
  const [overtimeEntries,setOvertimeEntries]=useState<OvertimeEntry[]>(cacheSeed?.overtimeEntries||[]);
  const [draftOT,setDraftOT]=useState<Record<string,string>>({});
  const [leaves,setLeaves]=useState<Leave[]>(cacheSeed?.leaves||[]);
  const [events,setEvents]=useState<Event[]>(cacheSeed?.events||[]);
  const [users,setUsers]=useState<UserProfile[]>(cacheSeed?.users||[]);
  const [backups,setBackups]=useState<BackupRow[]>(cacheSeed?.backups||[]);
  const [tab,setTab]=useState(()=>{try{return localStorage.getItem("shovonote:last-tab:"+profile.user_id)||"month";}catch{return "month";}});
  const [month,setMonth]=useState(()=>{try{const saved=localStorage.getItem("shovonote:last-month:"+profile.user_id);return saved?new Date(saved+"T00:00:00"):new Date();}catch{return new Date();}});
  const [busy,setBusy]=useState(false);
  const [search,setSearch]=useState("");
  const [notice,setNotice]=useState("");
  const [noticeError,setNoticeError]=useState(false);
  const [selectedDate,setSelectedDate]=useState(()=>{try{return localStorage.getItem("shovonote:last-date:"+profile.user_id)||today();}catch{return today();}});
  const [draftStatuses,setDraftStatuses]=useState<Record<string,string>>({});
  const [expandedCalendarEmployee,setExpandedCalendarEmployee]=useState<string|null>(()=>{try{return localStorage.getItem("shovonote:expanded-calendar-employee:"+profile.user_id)||null;}catch{return null;}});
  const [noteViewer,setNoteViewer]=useState<{employee:string;date:string;note:string}|null>(null);
  const [noteEditor,setNoteEditor]=useState<{employeeId:string;employee:string;date:string}|null>(null);
  const [bulkStatus,setBulkStatus]=useState("P");
  const [bulkOTHours,setBulkOTHours]=useState("2");
  const [selectedEmployee,setSelectedEmployee]=useState(profile.employee_id||"");
  const [employeeForm,setEmployeeForm]=useState<Partial<Employee>>({});
  const [editingEmployee,setEditingEmployee]=useState<string|null>(null);
  const [showEmployeeForm,setShowEmployeeForm]=useState(false);
  const [leaveForm,setLeaveForm]=useState({leave_type:"C/L",start_date:today(),end_date:today(),reason:""});
  const [eventForm,setEventForm]=useState({event_date:today(),event_type:"HOLIDAY",title:"",notes:""});
  const [accessForm,setAccessForm]=useState({user_id:"",role:"staff",employee_id:"",display_name:""});
  const [includeInactive,setIncludeInactive]=useState(false);
  const year=month.getFullYear();
  const first=dateKey(new Date(year,month.getMonth(),1));
  const last=dateKey(new Date(year,month.getMonth()+1,0));
  const yearFirst=dateKey(new Date(year,0,1));
  const yearLast=dateKey(new Date(year,11,31));
  const visibleEmployees=useMemo(()=>employees.filter(e=>(includeInactive||e.is_active)&&
    (canSeeAll||e.id===profile.employee_id)),[employees,includeInactive,canSeeAll,profile.employee_id]);
  const filtered=useMemo(()=>visibleEmployees.filter(e=>(e.full_name+" "+e.employee_code+" "+(e.department||"")).toLowerCase().includes(search.toLowerCase())),[visibleEmployees,search]);
  const lookup=useMemo(()=>new Map(attendance.map(a=>[a.employee_id+"|"+a.attendance_date,a])),[attendance]);
  const overtimeLookup=useMemo(()=>new Map(overtimeEntries.map(o=>[o.employee_id+"|"+o.overtime_date,o])),[overtimeEntries]);
  const eventDateLookup=useMemo(()=>new Map(events.filter(ev=>ev.event_type==="HOLIDAY"||ev.event_type==="WEEKLY_OFF").map(ev=>[ev.event_date,ev])),[events]);
  const calendarTone=(date:string,status:string)=>{
    if(new Date(date+"T00:00:00").getDay()===5||eventDateLookup.has(date)||status==="H"||status==="W/O")return "holiday";
    if(["P1","P2","C/L","C/L2","O/L","O/L2","S/L","H/L","LL/2"].includes(status))return "leave";
    return "";
  };
  const monthOTTotal=overtimeEntries.filter(o=>o.overtime_date>=first&&o.overtime_date<=last&&(!profile.employee_id||canSeeAll||o.employee_id===profile.employee_id)).reduce((sum,o)=>sum+Number(o.hours||0),0);
  const yearOTTotal=overtimeEntries.filter(o=>o.overtime_date>=yearFirst&&o.overtime_date<=yearLast&&(!profile.employee_id||canSeeAll||o.employee_id===profile.employee_id)).reduce((sum,o)=>sum+Number(o.hours||0),0);
  const employeeMap=useMemo(()=>new Map(employees.map(e=>[e.id,e])),[employees]);
  const selectedEmployeeRow=employeeMap.get(selectedEmployee);
  const days=Array.from({length:new Date(year,month.getMonth()+1,0).getDate()},(_,i)=>i+1);
  const years=Array.from({length:12},(_,i)=>i);

  function message(text:string,error=false){setNotice(text);setNoticeError(error);}
  async function load(){
    const cached=readAppCache(profile.user_id,profile.organization_id,year);
    if(cached){
      setEmployees(cached.employees);setAttendance(cached.attendance);setDailyNotes(cached.dailyNotes||[]);
      setDraftDailyNotes(Object.fromEntries((cached.dailyNotes||[]).map(n=>[n.employee_id+"|"+n.note_date,n.note||""])));
      setOvertimeEntries(cached.overtimeEntries||[]);setLeaves(cached.leaves||[]);setEvents(cached.events||[]);
      if(canManage){setUsers(cached.users||[]);setBackups(cached.backups||[]);}
    }
    setBusy(!cached);setNotice("");
    const fetchPaged=async<T,>(table:string,select:string,dateColumn:string):Promise<{rows:T[];error:any}>=>{
      let rows:T[]=[];
      for(let offset=0;;offset+=1000){
        const page=await supabase.from(table).select(select).gte(dateColumn,yearFirst).lte(dateColumn,yearLast).order(dateColumn).order("employee_id").range(offset,offset+999);
        if(page.error)return {rows,error:page.error};
        const part=(page.data||[]) as T[];rows=rows.concat(part);if(part.length<1000)break;
      }
      return {rows,error:null};
    };
    const tasks=await Promise.all([
      supabase.from("employees").select("id,employee_code,full_name,department,designation,email,phone,joining_date,emergency_contact,is_active").order("employee_code"),
      fetchPaged<Attendance>("attendance","id,employee_id,attendance_date,status,note","attendance_date"),
      supabase.from("attendance_daily_notes").select("id,employee_id,note_date,note").gte("note_date",yearFirst).lte("note_date",yearLast),
      fetchPaged<OvertimeEntry>("overtime_entries","id,employee_id,overtime_date,hours","overtime_date"),
      supabase.from("leave_requests").select("id,employee_id,leave_type,start_date,end_date,reason,status,created_at").order("created_at",{ascending:false}),
      supabase.from("calendar_events").select("id,event_date,event_type,title,notes").gte("event_date",yearFirst).lte("event_date",yearLast).order("event_date"),
      canManage?supabase.from("profiles").select("user_id,organization_id,role,employee_id,display_name").order("display_name"):Promise.resolve({data:cached?.users||[],error:null}),
      canManage?supabase.from("backup_files").select("id,file_name,storage_path,file_size,created_at").order("created_at",{ascending:false}):Promise.resolve({data:cached?.backups||[],error:null})
    ]);
    const [empRes,attRes,noteRes,otRes,leaveRes,eventRes,userRes,backupRes]=tasks;
    let refreshOk=true;
    if(empRes.error){message("Employee: "+empRes.error.message,true);refreshOk=false;}else{const sorted=sortEmployees((empRes.data||[]) as Employee[]);setEmployees(sorted);if(!selectedEmployee&&sorted[0])setSelectedEmployee(profile.employee_id||sorted[0].id);}
    if(attRes.error){message("Attendance: "+attRes.error.message,true);refreshOk=false;}else setAttendance(attRes.rows);
    if(noteRes.error){message("Daily Notes: "+noteRes.error.message,true);refreshOk=false;}else{const rows=(noteRes.data||[]) as DailyNote[];setDailyNotes(rows);setDraftDailyNotes(Object.fromEntries(rows.map(n=>[n.employee_id+"|"+n.note_date,n.note||""])));}
    if(otRes.error){message("OT Data: "+otRes.error.message,true);refreshOk=false;}else setOvertimeEntries(otRes.rows);
    if(leaveRes.error){message("Leave Data: "+leaveRes.error.message,true);refreshOk=false;}else setLeaves((leaveRes.data||[]) as Leave[]);
    if(eventRes.error){message("Calendar: "+eventRes.error.message,true);refreshOk=false;}else setEvents((eventRes.data||[]) as Event[]);
    if(canManage){if(userRes.error||backupRes.error)refreshOk=false;if(!userRes.error)setUsers((userRes.data||[]) as UserProfile[]);if(!backupRes.error)setBackups((backupRes.data||[]) as BackupRow[]);}
    if(refreshOk){
      const snapshot:AppDataCache={version:1,savedAt:Date.now(),employees:sortEmployees((empRes.data||[]) as Employee[]),attendance:attRes.rows,dailyNotes:(noteRes.data||[]) as DailyNote[],overtimeEntries:otRes.rows,leaves:(leaveRes.data||[]) as Leave[],events:(eventRes.data||[]) as Event[],users:canManage?((userRes.data||[]) as UserProfile[]):(cached?.users||[]),backups:canManage?((backupRes.data||[]) as BackupRow[]):(cached?.backups||[])};
      try{localStorage.setItem(appCacheKey(profile.user_id,profile.organization_id,year),JSON.stringify(snapshot));}catch{message("Data refreshed, but device storage is full. Clear browser cache to enable offline cache.",true);}
    }
    setBusy(false);
  }
  useEffect(()=>{void load();},[year,profile.user_id]);
  useEffect(()=>{try{localStorage.setItem("shovonote:last-tab:"+profile.user_id,tab);localStorage.setItem("shovonote:last-month:"+profile.user_id,dateKey(new Date(year,month.getMonth(),1)));localStorage.setItem("shovonote:last-date:"+profile.user_id,selectedDate);localStorage.setItem("shovonote:expanded-calendar-employee:"+profile.user_id,expandedCalendarEmployee||"");}catch{/* Browser storage may be unavailable; keep the current session working. */}},[tab,year,month.getMonth(),selectedDate,expandedCalendarEmployee,profile.user_id]);
  const scrollRestorePending=useRef(true);
  const restoreScrollRef=useRef<()=>void>(()=>{});
  useEffect(()=>{
    const key="shovonote:scroll-position:"+profile.user_id;
    let frame=0;
    let restoreFrame=0;
    let restoring=true;
    const readSaved=()=>{
      try{const value=Number(localStorage.getItem(key)||0);return Number.isFinite(value)&&value>0?value:0;}catch{return 0;}
    };
    const save=()=>{
      if(restoring)return;
      try{localStorage.setItem(key,String(window.scrollY));}catch{}
    };
    const onScroll=()=>{
      if(restoring||frame)return;
      frame=window.requestAnimationFrame(()=>{frame=0;save();});
    };
    const restore=()=>{
      if(restoreFrame)window.cancelAnimationFrame(restoreFrame);
      const target=readSaved();
      if(!target){restoring=false;return;}
      restoreFrame=window.requestAnimationFrame(()=>{
        restoreFrame=window.requestAnimationFrame(()=>{
          if(document.visibilityState==="visible")window.scrollTo({top:target,behavior:"instant"});
          restoring=false;
          restoreFrame=0;
        });
      });
    };
    restoreScrollRef.current=restore;
    const onPageHide=()=>{restoring=false;if(frame){window.cancelAnimationFrame(frame);frame=0;}save();};
    const onVisibility=()=>{
      if(document.visibilityState==="hidden")onPageHide();
      else if(scrollRestorePending.current)restore();
    };
    window.addEventListener("scroll",onScroll,{passive:true});
    window.addEventListener("pagehide",onPageHide);
    window.addEventListener("beforeunload",onPageHide);
    window.addEventListener("pageshow",event=>{if((event as PageTransitionEvent).persisted)restore();});
    document.addEventListener("visibilitychange",onVisibility);
    return ()=>{
      if(frame)window.cancelAnimationFrame(frame);
      if(restoreFrame)window.cancelAnimationFrame(restoreFrame);
      onPageHide();
      window.removeEventListener("scroll",onScroll);
      window.removeEventListener("pagehide",onPageHide);
      window.removeEventListener("beforeunload",onPageHide);
      document.removeEventListener("visibilitychange",onVisibility);
    };
  },[profile.user_id]);
  useEffect(()=>{
    if(busy||!scrollRestorePending.current)return;
    scrollRestorePending.current=false;
    restoreScrollRef.current();
  },[busy,profile.user_id]);
  useEffect(()=>{
    const onWheel=(event:WheelEvent)=>{
      if(!event.shiftKey||Math.abs(event.deltaY)<1)return;
      const tables=Array.from(document.querySelectorAll<HTMLElement>(".table-wrap")).filter(el=>el.scrollWidth>el.clientWidth+4&&el.getBoundingClientRect().height>0);
      if(!tables.length)return;
      const active=tables.find(el=>{const r=el.getBoundingClientRect();return r.top<window.innerHeight&&r.bottom>0;})||tables[0];
      active.scrollLeft+=event.deltaY;
      event.preventDefault();
    };
    document.addEventListener("wheel",onWheel,{passive:false});
    return()=>document.removeEventListener("wheel",onWheel);
  },[tab]);
  useEffect(()=>{const allowed=canSeeAll?["month","year","employees","leaves","calendar","overtime","ot-calendar",...(canManage?["access","backups"]:[])]:["mine","leaves","overtime","ot-calendar"];if(!allowed.includes(tab))setTab(allowed[0]);},[tab,canSeeAll,canManage]);
  async function setStatus(employeeId:string,date:string,status:string){
    if(!canManage)return;setBusy(true);
    const old=lookup.get(employeeId+"|"+date);
    let result;
    if(!status&&old?.id)result=await supabase.from("attendance").delete().eq("id",old.id);
    else if(old?.id)result=await supabase.from("attendance").update({status}).eq("id",old.id);
    else if(status)result=await supabase.from("attendance").upsert({organization_id:profile.organization_id,employee_id:employeeId,attendance_date:date,status,entered_by:profile.user_id},{onConflict:"employee_id,attendance_date"});
    if(result?.error)message(result.error.message,true);else{message(" Save ");await load();}
    setBusy(false);
  }
  function stageStatus(employeeId:string,date:string,status:string){setDraftStatuses(prev=>({...prev,[employeeId+"|"+date]:status}));}
  async function saveDailyNote(employeeId:string,date:string){
    if(!canManage)return;const key=employeeId+"|"+date;const note=(draftDailyNotes[key]||"").trim();const existing=dailyNotes.find(n=>n.employee_id===employeeId&&n.note_date===date);setBusy(true);
    const result=note
      ? await supabase.from("attendance_daily_notes").upsert({organization_id:profile.organization_id,employee_id:employeeId,note_date:date,note,updated_by:profile.user_id,updated_at:new Date().toISOString()},{onConflict:"organization_id,employee_id,note_date"})
      : existing?await supabase.from("attendance_daily_notes").delete().eq("id",existing.id):{error:null};
    if(result.error)message(result.error.message,true);else{message("Daily note saved");setNoteEditor(null);await load();}
    setBusy(false);
  }
  async function saveStagedStatus(employeeId:string,date:string){
    const key=employeeId+"|"+date;const status=draftStatuses[key];
    if(status===undefined)return;
    await setStatus(employeeId,date,status);
    setDraftStatuses(prev=>{const next={...prev};delete next[key];return next;});
  }
  async function saveOvertime(employeeId:string,date:string,hoursText:string){
    if(!canManage)return;setBusy(true);const key=employeeId+"|"+date;const existing=overtimeLookup.get(key);const raw=hoursText.trim();let result:any;
    if((!raw||Number(raw)===0)&&existing)result=await supabase.from("overtime_entries").delete().eq("id",existing.id);
    else if(raw){const hours=Number(raw);if(!Number.isFinite(hours)||hours<0||hours>24){message("OT Hours must be between 0 and 24",true);setBusy(false);return;}if(hours===0){message("No OT — existing entry cleared");}else if(existing)result=await supabase.from("overtime_entries").update({hours,entered_by:profile.user_id,updated_at:new Date().toISOString()}).eq("id",existing.id);else result=await supabase.from("overtime_entries").insert({organization_id:profile.organization_id,employee_id:employeeId,overtime_date:date,hours,entered_by:profile.user_id});}
    if(result?.error)message(result.error.message,true);else message("OT Hours Save ");setDraftOT(prev=>{const next={...prev};delete next[key];return next;});await load();setBusy(false);
  }
  async function updateAllOT(){
    if(!canManage)return;
    const hours=Number(bulkOTHours);
    if(!Number.isFinite(hours)||hours<0||hours>24){message("OT Hours must be between 0 and 24",true);return;}
    const active=employees.filter(e=>e.is_active);
    const action=hours===0?"clear OT for":"set OT to "+hours+" Hours for";
    if(!window.confirm(selectedDate+" — "+action+" all "+active.length+" active employees?"))return;
    setBusy(true);
    const result=hours===0
      ? await supabase.from("overtime_entries").delete().eq("overtime_date",selectedDate).in("employee_id",active.map(e=>e.id))
      : await supabase.from("overtime_entries").upsert(active.map(e=>({organization_id:profile.organization_id,employee_id:e.id,overtime_date:selectedDate,hours,entered_by:profile.user_id})),{onConflict:"organization_id,employee_id,overtime_date"});
    const error=result.error;
    if(error)message(error.message,true);else message(hours===0?"OT cleared for all active employees": "OT updated for all active employees: "+hours+" Hours");
    await load();setBusy(false);
  }
  function exportOTMonth(){const rows:unknown[][]=[["Control No","Employee","Date","OT Hours"]];employees.filter(e=>e.is_active&&(!profile.employee_id||canSeeAll||e.id===profile.employee_id)).forEach(e=>days.forEach(d=>{const date=dateKey(new Date(year,month.getMonth(),d));const entry=overtimeLookup.get(e.id+"|"+date);if(entry)rows.push([e.employee_code,e.full_name,date,Number(entry.hours)]);}));csvDownload(rows,"overtime-"+first.slice(0,7)+".csv");}
  async function updateAll(status:string){
    if(!canManage)return;
    const label=LABELS[status]||status;
    if(!window.confirm(selectedDate+" on All Active  "+status+" ("+label+") Continue??"))return;
    setBusy(true);
    const rows=employees.filter(e=>e.is_active).map(e=>({organization_id:profile.organization_id,employee_id:e.id,attendance_date:selectedDate,status,entered_by:profile.user_id}));
    const {error}=await supabase.from("attendance").upsert(rows,{onConflict:"employee_id,attendance_date"});
    if(error)message(error.message,true);else message("Selected Date All Active Employee "+status+"  ");
    await load();setBusy(false);
  }
  function monthlyRegisterHtml(){
    const roster=sortEmployees(employees.filter(e=>e.is_active&&(!profile.employee_id||canSeeAll||e.id===profile.employee_id)));
    const esc=(value:unknown)=>String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
    const statusStyle=(status:string,date:string)=>{
      if(!status)return new Date(date+"T00:00:00").getDay()===5?"background:#f1f2f2;color:#777;":"";
      if(status==="H"||status==="W/O"||status==="L/L")return "background:#fde9e9;color:#a23b42;font-weight:bold;";
      if(["P1","P2","C/L","C/L2","O/L","O/L2","S/L","H/L","LL/2"].includes(status))return "background:#fff1d8;color:#805b1c;font-weight:bold;";
      if(PRESENT_STATUSES.includes(status))return "background:#e8f4eb;color:#1c6545;font-weight:bold;";
      if(status==="A")return "background:#fce9e6;color:#a13b2d;font-weight:bold;";
      return "background:#f0f3f1;color:#53645b;font-weight:bold;";
    };
    const dayHeaders=days.map(d=>{const date=dateKey(new Date(year,month.getMonth(),d));return '<th class="day"><span>'+weekday(date)+'</span><b>'+d+'</b></th>';}).join("");
    const body=roster.map(emp=>{
      const records=days.map(d=>{const date=dateKey(new Date(year,month.getMonth(),d));const status=lookup.get(emp.id+"|"+date)?.status||"";return {date,status};});
      const present=records.filter(x=>PRESENT_STATUSES.includes(x.status)).length;
      const casual=records.filter(x=>x.status==="C/L").length+records.filter(x=>x.status==="C/L2").length*.5+records.filter(x=>x.status==="P1").length/8+records.filter(x=>x.status==="P2").length/4;
      const official=records.filter(x=>x.status==="O/L").length+records.filter(x=>x.status==="O/L2").length*.5;
      const sick=records.filter(x=>x.status==="S/L").length;
      const absent=records.filter(x=>x.status==="A").length;
      const duty=records.reduce((sum,x)=>sum+(DUTY_HOURS[x.status]??0),0);
      const ot=overtimeEntries.filter(x=>x.employee_id===emp.id&&x.overtime_date>=first&&x.overtime_date<=last).reduce((sum,x)=>sum+Number(x.hours||0),0);
      const cells=records.map(x=>'<td class="mark" style="'+statusStyle(x.status,x.date)+'">'+esc(x.status)+'</td>').join("");
      return '<tr><td class="code">'+esc(emp.employee_code)+'</td><td class="employee">'+esc(emp.full_name)+'</td><td class="dept">'+esc(emp.department||"")+'</td>'+cells+
        '<td class="total">'+present+'</td><td class="total">'+casual+'</td><td class="total">'+official+'</td><td class="total">'+sick+'</td><td class="total">'+absent+'</td><td class="total">'+duty+'</td><td class="total">'+ot+'</td></tr>';
    }).join("");
    const dailyPresent=days.map(d=>{const date=dateKey(new Date(year,month.getMonth(),d));return '<td class="mark total">'+roster.filter(emp=>PRESENT_STATUSES.includes(lookup.get(emp.id+"|"+date)?.status||"")).length+'</td>';}).join("");
    const grandPresent=roster.reduce((sum,emp)=>sum+days.filter(d=>PRESENT_STATUSES.includes(lookup.get(emp.id+"|"+dateKey(new Date(year,month.getMonth(),d)))?.status||"")).length,0);
    const grandDuty=roster.reduce((sum,emp)=>sum+days.reduce((n,d)=>n+(DUTY_HOURS[lookup.get(emp.id+"|"+dateKey(new Date(year,month.getMonth(),d)))?.status||""]??0),0),0);
    const grandOT=overtimeEntries.filter(x=>x.overtime_date>=first&&x.overtime_date<=last&&roster.some(e=>e.id===x.employee_id)).reduce((sum,x)=>sum+Number(x.hours||0),0);
    return '<!doctype html><html><head><meta charset="utf-8"><title>Attendance Register - '+MONTHS[month.getMonth()]+' '+year+'</title><style>'+
      '@page{size:A3 landscape;margin:8mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#1f3329;margin:0}h1{font-size:19px;text-align:center;margin:0 0 4px;letter-spacing:.5px}h2{font-size:14px;text-align:center;margin:0 0 5px;color:#315744}.meta{text-align:center;font-size:9px;margin-bottom:10px;color:#52685e}.summary{display:flex;justify-content:space-between;font-size:9px;margin:5px 0 8px}.register{width:100%;border-collapse:collapse;table-layout:fixed}.register th,.register td{border:1px solid #9eada4;padding:3px 2px;text-align:center;font-size:8px;line-height:1.15}.register thead th{background:#e8f0ea;color:#254a38;font-weight:bold}.register th.day{width:19px}.register th.day span{display:block;font-size:6px;color:#66796d}.register th.day b{display:block;font-size:8px}.register .code{width:42px;font-weight:bold}.register .employee{width:125px;text-align:left;padding-left:5px;font-weight:bold}.register .dept{width:58px}.register .mark{width:19px}.register .total{background:#f0f4f1;font-weight:bold;width:35px}.register tbody tr:nth-child(even){background:#fafcfb}.register tfoot td{background:#eaf1ec;font-weight:bold}.legend{font-size:8px;margin-top:8px;line-height:1.7}.legend b{margin-right:8px}.footnote{font-size:7px;color:#607268;margin-top:5px}@media screen{body{padding:16px}.register{min-width:1100px}.sheet{overflow:auto}}'+
      '</style></head><body><h1>EMPLOYEE ATTENDANCE REGISTER</h1><h2>'+MONTHS[month.getMonth()].toUpperCase()+' '+year+'</h2><div class="meta">Monthly Attendance &amp; Duty Record · ShovoNote</div><div class="summary"><span>Total Employees: <b>'+roster.length+'</b></span><span>Present Entries: <b>'+grandPresent+'</b></span><span>Total Duty Hours: <b>'+grandDuty+'</b></span><span>Total OT Hours: <b>'+grandOT+'</b></span></div><div class="sheet"><table class="register"><thead><tr><th rowspan="2">Control<br>No.</th><th rowspan="2">Employee Name</th><th rowspan="2">Dept.</th>'+days.map(d=>'<th class="day"><span>'+weekday(dateKey(new Date(year,month.getMonth(),d)))+'</span></th>').join("")+'<th rowspan="2">Present</th><th rowspan="2">C/L</th><th rowspan="2">O/L</th><th rowspan="2">S/L</th><th rowspan="2">Absent</th><th rowspan="2">Duty<br>Hrs</th><th rowspan="2">OT<br>Hrs</th></tr><tr>'+days.map(d=>'<th class="day"><b>'+d+'</b></th>').join("")+'</tr></thead><tbody>'+body+'</tbody><tfoot><tr><td colspan="3">Daily Present</td>'+dailyPresent+'<td colspan="7">Month Summary</td></tr></tfoot></table></div><div class="legend"><b>Status Legend:</b> P = Present · P1/P2 = Short Leave · A = Absent · C/L = Casual Leave · C/L2 = Half-day Casual Leave · O/L = Official Leave · O/L2 = Half-day Official Leave · S/L = Sick Leave · H = Holiday · W/O = Weekly Off · L/L = Compensatory Off · H/L = Half-day Leave · L/O = Lay Off</div><div class="footnote">Blank cells indicate no attendance entry. Duty hours are calculated from saved attendance statuses. OT hours are shown separately.</div></body></html>';
  }
  function exportMonthExcel(){
    downloadBlob(monthlyRegisterHtml(),"Attendance-"+first.slice(0,7)+".xls","application/vnd.ms-excel;charset=utf-8");
    message("Monthly Excel register exported.");
  }
  function exportMonthPdf(){
    const printWindow=window.open("","_blank");
    if(!printWindow){message("Allow pop-ups to export the monthly PDF.",true);return;}
    printWindow.document.open();printWindow.document.write(monthlyRegisterHtml());printWindow.document.close();
    window.setTimeout(()=>{printWindow.focus();printWindow.print();},500);
  }
  function exportEmployees(){
    csvDownload([["Control No","Name","Department","Designation","Phone","Email","Joining Date","Active"],...employees.map(e=>[e.employee_code,e.full_name,e.department,e.designation,e.phone,e.email,e.joining_date,e.is_active?"Yes":"No"])],"employees.csv");
  }
  const totals=(id:string)=>{const rows=attendance.filter(a=>a.employee_id===id&&a.attendance_date>=yearFirst&&a.attendance_date<=yearLast);const casualUsed=rows.filter(a=>a.status==="C/L").length+rows.filter(a=>a.status==="C/L2").length*.5+rows.filter(a=>a.status==="P1").length/8+rows.filter(a=>a.status==="P2").length/4;return STATUSES.map(s=>({s,n:rows.filter(a=>a.status===s).length*(["C/L2","O/L2","H/L"].includes(s)?0.5:1)})).concat([{s:"C/L Used",n:casualUsed},{s:"C/L Left",n:Math.max(0,10-casualUsed)}]);};
  const monthCount=(status:string)=>attendance.filter(a=>(status==="P"?PRESENT_STATUSES.includes(a.status):a.status===status)&&a.attendance_date>=first&&a.attendance_date<=last).length;
  async function saveEmployee(e:FormEvent){
    e.preventDefault();if(!canManage)return;setBusy(true);
    const payload={organization_id:profile.organization_id,employee_code:employeeForm.employee_code||"",full_name:employeeForm.full_name||"",department:employeeForm.department||null,designation:employeeForm.designation||null,email:employeeForm.email||null,phone:employeeForm.phone||null,joining_date:employeeForm.joining_date||null,emergency_contact:employeeForm.emergency_contact||null,is_active:employeeForm.is_active!==false};
    const result=editingEmployee?await supabase.from("employees").update(payload).eq("id",editingEmployee):await supabase.from("employees").insert(payload);
    if(result.error)message(result.error.message,true);else{message(" Data Save ");setShowEmployeeForm(false);setEditingEmployee(null);setEmployeeForm({});await load();}
    setBusy(false);
  }
  function editEmployee(e:Employee){setEditingEmployee(e.id);setEmployeeForm({...e});setShowEmployeeForm(true);}
  async function submitLeave(e:React.FormEvent){
    e.preventDefault();const employeeId=canManage?selectedEmployee:profile.employee_id;
    if(!employeeId){message("Employee Select Please",true);return;}
    setBusy(true);
    const payload={organization_id:profile.organization_id,employee_id:employeeId,leave_type:leaveForm.leave_type,start_date:leaveForm.start_date,end_date:leaveForm.end_date,reason:leaveForm.reason||null,status:"pending"};
    const {error}=await supabase.from("leave_requests").insert(payload);
    if(error)message(error.message,true);else{message("Leave  Submit ");setLeaveForm({leave_type:"C/L",start_date:today(),end_date:today(),reason:""});await load();}
    setBusy(false);
  }
  async function reviewLeave(id:string,status:string){
    if(!canManage)return;setBusy(true);
    const {error}=await supabase.from("leave_requests").update({status,reviewed_by:profile.user_id}).eq("id",id);
    if(error)message(error.message,true);else{
      if(status==="approved"){
        const item=leaves.find(l=>l.id===id);
        if(item){
          const rows:any[]=[];const cursor=new Date(item.start_date+"T00:00:00");const end=new Date(item.end_date+"T00:00:00");
          while(cursor<=end){rows.push({organization_id:profile.organization_id,employee_id:item.employee_id,attendance_date:dateKey(cursor),status:item.leave_type,entered_by:profile.user_id,note:"Approved leave"});cursor.setDate(cursor.getDate()+1);}
          if(rows.length){const applied=await supabase.from("attendance").upsert(rows,{onConflict:"employee_id,attendance_date"});if(applied.error)message(" Approved,  to attendance Leave : "+applied.error.message,true);}
        }
      }
      message(status==="approved"?"Leave  Approved":"Leave  Rejected");await load();
    }
    setBusy(false);
  }
  async function saveEvent(e:React.FormEvent){
    e.preventDefault();if(!canManage)return;setBusy(true);
    const {error}=await supabase.from("calendar_events").insert({organization_id:profile.organization_id,event_date:eventForm.event_date,event_type:eventForm.event_type,title:eventForm.title,notes:eventForm.notes||null});
    if(error)message(error.message,true);else{
      if(eventForm.event_type==="HOLIDAY"||eventForm.event_type==="WEEKLY_OFF"){
        const status=eventForm.event_type==="HOLIDAY"?"H":"W/O";
        const rows=employees.filter(emp=>emp.is_active).map(emp=>({organization_id:profile.organization_id,employee_id:emp.id,attendance_date:eventForm.event_date,status,entered_by:profile.user_id}));
        const result=await supabase.from("attendance").upsert(rows,{onConflict:"employee_id,attendance_date"});
        if(result.error)message("Event stored,    : "+result.error.message,true);
      }
      message("Calendar Event Save ");setEventForm({event_date:today(),event_type:"HOLIDAY",title:"",notes:""});await load();
    }setBusy(false);
  }
  async function deleteEvent(id:string){
    if(!canManage||!window.confirm("This Calendar Event ?"))return;
    const {error}=await supabase.from("calendar_events").delete().eq("id",id);
    if(error)message(error.message,true);else{message("Event   ");await load();}
  }
  async function saveAccess(e:React.FormEvent){
    e.preventDefault();if(!canManage)return;
    if(!accessForm.user_id.trim()){message("Supabase Auth User ID Date",true);return;}
    setBusy(true);
    const payload={user_id:accessForm.user_id.trim(),organization_id:profile.organization_id,role:accessForm.role,employee_id:accessForm.role==="staff"?(accessForm.employee_id||null):null,display_name:accessForm.display_name||null};
    const {error}=await supabase.from("profiles").upsert(payload,{onConflict:"user_id"});
    if(error)message(error.message,true);else{message("Access Profile Save ");setAccessForm({user_id:"",role:"staff",employee_id:"",display_name:""});await load();}
    setBusy(false);
  }
  async function removeAccess(userId:string){
    if(!canManage||userId===profile.user_id||!window.confirm("This  Access Profile ?"))return;
    const {error}=await supabase.from("profiles").delete().eq("user_id",userId);
    if(error)message(error.message,true);else{message("Access  ");await load();}
  }
  async function makeBackup(){
    if(!canManage)return;setBusy(true);
    const {data:allDailyNotes,error:notesError}=await supabase.from("attendance_daily_notes").select("*");
    if(notesError){message("Daily notes backup: "+notesError.message,true);setBusy(false);return;}
    const payload={app:"Employee Attendance System",version:1,created_at:new Date().toISOString(),organization_id:profile.organization_id,employees,attendance,attendance_daily_notes:allDailyNotes||[],overtime_entries:overtimeEntries,leave_requests:leaves,calendar_events:events};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const fileName="attendance-backup-"+today()+".json";
    const path=profile.organization_id+"/"+Date.now()+"-"+fileName;
    const {error:uploadError}=await supabase.storage.from("workledger-backups").upload(path,blob,{contentType:"application/json",upsert:false});
    if(uploadError){message(uploadError.message,true);setBusy(false);return;}
    const {error:metaError}=await supabase.from("backup_files").insert({organization_id:profile.organization_id,storage_path:path,file_name:fileName,content_type:"application/json",file_size:blob.size,uploaded_by:profile.user_id});
    if(metaError)message("  ,   Add : "+metaError.message,true);else message("Backup  Save ");
    await load();setBusy(false);
  }
  async function downloadBackup(path:string,name:string){
    const {data,error}=await supabase.storage.from("workledger-backups").download(path);
    if(error){message(error.message,true);return;}
    if(data){const url=URL.createObjectURL(data);const a=document.createElement("a");a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}
  }
  async function restoreBackup(file:File){
    if(!canManage)return;
    if(!window.confirm("     Add/Update be। No  Records   be । ?"))return;
    setBusy(true);
    try{
      const raw=JSON.parse(await file.text());
      if(raw.organization_id!==profile.organization_id)throw new Error("This   ।");
      const groups:[string,any[]][]=[["employees",raw.employees||[]],["attendance",raw.attendance||[]],["attendance_monthly_notes",raw.attendance_monthly_notes||[]],["attendance_daily_notes",raw.attendance_daily_notes||[]],["overtime_entries",raw.overtime_entries||[]],["leave_requests",raw.leave_requests||[]],["calendar_events",raw.calendar_events||[]]];
      for(const [table,rows] of groups){
        if(!rows.length)continue;
        const safe=rows.map(row=>{const copy={...row};delete copy.created_at;return copy;});
        const {error}=await supabase.from(table).upsert(safe);
        if(error)throw new Error(table+": "+error.message);
      }
      message("   ");await load();
    }catch(err){message(err instanceof Error?err.message:"Backup  ",true);}
    setBusy(false);
  }
  async function deleteBackup(id:string,path:string){
    if(!canManage||!window.confirm("This Backup  ?"))return;
    const {error:storageError}=await supabase.storage.from("workledger-backups").remove([path]);
    if(storageError){message(storageError.message,true);return;}
    const {error}=await supabase.from("backup_files").delete().eq("id",id);
    if(error)message(error.message,true);else{message("Backup   ");await load();}
  }

  const tabs=[
    ...(canSeeAll?[{id:"month",label:" ",icon:<CalendarDays/>},{id:"year",label:" Calendar",icon:<CalendarCheck/>},{id:"employees",label:"Employee",icon:<Users/>}]:[{id:"mine",label:"My ",icon:<UserRound/>}]),
    {id:"overtime",label:"OT ",icon:<Clock/>},{id:"ot-calendar",label:"OT Calendar",icon:<CalendarDays/>},
    {id:"leaves",label:"Leave ",icon:<ClipboardList/>},
    ...(canSeeAll?[{id:"calendar",label:"Leave and Holiday",icon:<CalendarDays/>}]:[]),
    ...(canManage?[{id:"access",label:"Access",icon:<Shield/>},{id:"backups",label:"Backup",icon:<HardDrive/>}]:[])
  ];
  const currentTitle=tabs.find(t=>t.id===tab)?.label||"Employee Attendance System";
  return <div className="shell">
    <main className="main">
      <header className="topbar"><div className="brand"><div className="brand-mark">SN</div><div><h1>ShovoNote</h1><p>{currentTitle} · Developed by Shovo Sarker</p></div></div><div className="actions"><button className="icon-btn" onClick={()=>void load()} title="Refresh"><RefreshCw/></button><button className="icon-btn" onClick={()=>window.print()} title="Print / PDF"><Printer/></button><button onClick={()=>supabase.auth.signOut()}><LogOut/> Sign Out</button></div></header>
      <nav className="top-navigation">{tabs.map(t=><button key={t.id} className={tab===t.id?"active":""} onClick={()=>setTab(t.id)}>{t.icon}{t.label}</button>)}</nav>
      {notice&&<div className={noticeError?"notice error":"notice success"}>{notice}</div>}
      {tab!=="access"&&tab!=="backups"&&<section className="stats">
        <div><span>Total Employee</span><strong>{canSeeAll?employees.filter(e=>e.is_active).length:(profile.employee_id?1:0)}</strong></div>
        <div><span>This Month Present</span><strong>{canSeeAll?monthCount("P"):attendance.filter(a=>a.employee_id===profile.employee_id&&a.status==="P"&&a.attendance_date>=first&&a.attendance_date<=last).length}</strong></div>
        <div><span>This Month OT Hours</span><strong>{monthOTTotal.toLocaleString("en-US")}</strong></div>
        <div><span>Pending Leave </span><strong>{leaves.filter(l=>l.status==="pending"&&(canManage||l.employee_id===profile.employee_id)).length}</strong></div>
      </section>}

      {(tab==="month"||tab==="year")&&<div className="toolbar">
        <div className="month-nav"><button onClick={()=>setMonth(new Date(year,month.getMonth()-1,1))}><ChevronLeft/></button><b>{MONTHS[month.getMonth()]} {year}</b><button onClick={()=>setMonth(new Date(year,month.getMonth()+1,1))}><ChevronRight/></button></div>
        <div className="actions">{canManage&&tab==="month"&&<><Field label="Entry "><input type="date" value={selectedDate} onChange={e=>{setSelectedDate(e.target.value);const d=new Date(e.target.value+"T00:00:00");setMonth(new Date(d.getFullYear(),d.getMonth(),1));}}/><small className="weekday-hint">{weekday(selectedDate)}day</small></Field><Field label="All  "><select value={bulkStatus} onChange={e=>setBulkStatus(e.target.value)}>{STATUSES.map(s=><option key={s} value={s}>{s} · {LABELS[s]}</option>)}</select></Field><button className="primary bulk-action" onClick={()=>void updateAll(bulkStatus)} disabled={busy}>Update All Status</button></>}<button onClick={exportMonthExcel}><FileDown/> Excel</button><button onClick={exportMonthPdf}><Printer/> PDF</button></div>
      </div>}
      {tab==="overtime"&&<><div className="toolbar"><div className="month-nav"><button onClick={()=>setMonth(new Date(year,month.getMonth()-1,1))}><ChevronLeft/></button><b>{MONTHS[month.getMonth()]} {year} · OT</b><button onClick={()=>setMonth(new Date(year,month.getMonth()+1,1))}><ChevronRight/></button></div><div className="actions">{canManage&&<><Field label="OT Entry "><input type="date" value={selectedDate} onChange={e=>{setSelectedDate(e.target.value);const d=new Date(e.target.value+"T00:00:00");setMonth(new Date(d.getFullYear(),d.getMonth(),1));}}/><small className="weekday-hint">{weekday(selectedDate)}day</small></Field><Field label="All OT Hours"><select value={bulkOTHours} onChange={e=>setBulkOTHours(e.target.value)}><option value="0">No OT (0 Hours)</option>{Array.from({length:48},(_,i)=>(i+1)*0.5).map(h=><option key={h} value={h}>{h} Hours</option>)}</select></Field><button className="primary bulk-action" onClick={()=>void updateAllOT()} disabled={busy}>Update All</button></>}<button onClick={exportOTMonth}><Download/> CSV</button></div></div><div className="ot-summary"><strong> Total OT: {monthOTTotal.toLocaleString("en-US")} Hours</strong><span>Selected : {selectedDate}</span></div><div className="table-wrap"><table><thead><tr><th>Control No</th><th> Name</th>{days.map(d=>{const date=dateKey(new Date(year,month.getMonth(),d));return <th key={d} className={date===selectedDate?"selected-date-head":""}><span className={"weekday-head "+(new Date(date+"T00:00:00").getDay()===5?"friday-label":"")}>{weekday(date)}</span><b>{d}</b></th>;})}<th>Total OT Hours</th></tr></thead><tbody>{filtered.map(emp=><tr key={emp.id}><td>{emp.employee_code}</td><td className="name-cell">{emp.full_name}<small>{emp.department||""}</small></td>{days.map(d=>{const date=dateKey(new Date(year,month.getMonth(),d));const key=emp.id+"|"+date;const entry=overtimeLookup.get(key);const draft=draftOT[key];const selected=date===selectedDate;return <td key={d} className={selected?"selected-date-cell":""}>{selected&&canManage?<div className="cell-editor"><input className="status ot-hour-input" type="number" min="0" max="24" step="0.25" placeholder="h" value={draft===undefined?(entry?String(entry.hours):""):draft} disabled={busy} onChange={e=>setDraftOT(prev=>({...prev,[key]:e.target.value}))}/><button className="save-cell" disabled={busy||draft===undefined} onClick={()=>void saveOvertime(emp.id,date,draft)}>Save</button></div>:<span className="ot-hour-value">{entry?Number(entry.hours).toLocaleString("en-US")+"h":""}</span>}</td>;})}<td>{overtimeEntries.filter(o=>o.employee_id===emp.id&&o.overtime_date>=first&&o.overtime_date<=last).reduce((sum,o)=>sum+Number(o.hours||0),0).toLocaleString("en-US")} h</td></tr>)}</tbody></table></div></>}
      {tab==="month"&&<div className="table-wrap"><table><thead><tr><th>Control No</th><th> Name</th>{days.map(d=>{const date=dateKey(new Date(year,month.getMonth(),d));return <th key={d} className={date===selectedDate?"selected-date-head":""}><span className={"weekday-head "+(new Date(date+"T00:00:00").getDay()===5?"friday-label":"")}>{weekday(date)}</span><b>{d}</b></th>;})}<th>Present</th><th>Duty Hours</th></tr></thead><tbody>
        {filtered.map(emp=><tr key={emp.id}><td>{emp.employee_code}</td><td className="name-cell">{emp.full_name}<small>{emp.department||""}</small></td>
          {days.map(d=>{const date=dateKey(new Date(year,month.getMonth(),d));const key=emp.id+"|"+date;const st=lookup.get(key)?.status||"";const otEntry=overtimeLookup.get(key);const tone=calendarTone(date,st);const isSelected=date===selectedDate;const draft=draftStatuses[key];return <td key={d} className={(isSelected?"selected-date-cell ":"")+(tone==="holiday"?"official-holiday-cell ":tone==="leave"?"personal-leave-cell ":"")}>{isSelected&&canManage?<div className="cell-editor"><StatusSelect value={draft===undefined?st:draft} disabled={busy} onChange={v=>stageStatus(emp.id,date,v)}/><button className="save-cell" disabled={busy||draft===undefined} onClick={()=>void saveStagedStatus(emp.id,date)}>Save</button><button type="button" className="save-cell note-open" disabled={busy} onClick={()=>{const saved=dailyNotes.find(n=>n.employee_id===emp.id&&n.note_date===date)?.note||"";setDraftDailyNotes(prev=>({...prev,[key]:saved}));setNoteEditor({employeeId:emp.id,employee:emp.full_name,date});}}>Note{dailyNotes.some(n=>n.employee_id===emp.id&&n.note_date===date)?" •":""}</button></div>:<span className="date-cell-content"><StatusDisplay status={st} overtimeHours={otEntry?.hours||0} tone={tone}/>{dailyNotes.some(n=>n.employee_id===emp.id&&n.note_date===date)&&<button type="button" className="note-indicator" aria-label="View saved note" title="Click to view saved note" onClick={()=>setNoteViewer({employee:emp.full_name,date,note:dailyNotes.find(n=>n.employee_id===emp.id&&n.note_date===date)?.note||""})}>✎</button>}</span>}</td>;})}
          <td>{attendance.filter(a=>a.employee_id===emp.id&&PRESENT_STATUSES.includes(a.status)&&a.attendance_date>=first&&a.attendance_date<=last).length}</td><td>{attendance.filter(a=>a.employee_id===emp.id&&a.attendance_date>=first&&a.attendance_date<=last).reduce((sum,a)=>sum+(DUTY_HOURS[a.status]??0),0)} h</td></tr>)}
      </tbody></table></div>}
      
      {tab==="year"&&<><div className="calendar-year-picker"><label>Calendar  <select value={year} onChange={e=>setMonth(new Date(Number(e.target.value),month.getMonth(),1))}>{Array.from({length:9},(_,i)=>new Date().getFullYear()-4+i).map(y=><option key={y} value={y}>{y}</option>)}</select></label><span className="muted">Calendar to view  Name select</span></div><div className="employee-list calendar-employee-list">{filtered.map(emp=><div className="calendar-employee" key={emp.id}><button className={"calendar-employee-toggle "+(expandedCalendarEmployee===emp.id?"expanded":"")} onClick={()=>setExpandedCalendarEmployee(prev=>prev===emp.id?null:emp.id)}><span><b>{emp.employee_code}</b><strong>{emp.full_name}</strong></span><span>{expandedCalendarEmployee===emp.id?"Hide calendar":"View calendar"} <span className="toggle-mark">{expandedCalendarEmployee===emp.id?"−":"＋"}</span></span></button>{expandedCalendarEmployee===emp.id&&<article className="employee-year calendar-expanded"><div className="months">{years.map(i=>{const count=new Date(year,i+1,0).getDate();const offset=new Date(year,i,1).getDay();return <div className="mini-month" key={i}><b>{MONTHS[i]}</b><div className="days"><span className="weekday-label">Sun</span><span className="weekday-label">Mon</span><span className="weekday-label">Tue</span><span className="weekday-label">Wed</span><span className="weekday-label">Thu</span><span className="weekday-label friday-label">Fri</span><span className="weekday-label">Sat</span>{Array.from({length:offset},(_,n)=><span key={"blank"+n}/>)}{Array.from({length:count},(_,d)=>{const date=dateKey(new Date(year,i,d+1));const st=lookup.get(emp.id+"|"+date)?.status||"";const dayNote=dailyNotes.find(n=>n.employee_id===emp.id&&n.note_date===date)?.note;const otEntry=overtimeLookup.get(emp.id+"|"+date);const tone=calendarTone(date,st);return <span title={date+" "+(LABELS[st]||"")+(otEntry?" · OT "+otEntry.hours+" Hours":"")+(dayNote?" · Click to view note":"")} role={dayNote?"button":undefined} tabIndex={dayNote?0:undefined} onClick={dayNote?()=>setNoteViewer({employee:emp.full_name,date,note:dayNote}):undefined} onKeyDown={dayNote?e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();setNoteViewer({employee:emp.full_name,date,note:dayNote});}}:undefined} className={(tone==="holiday"?"official-holiday-cell ":tone==="leave"?"personal-leave-cell ":"")+(st?"day-"+st.replace("/","-"):"")+(dayNote?" has-day-note":"")} key={d}>{st?<StatusDisplay status={st} overtimeHours={otEntry?.hours||0} tone={tone}/>:d+1}{dayNote&&<i className="calendar-note-dot"/>}</span>;})}</div></div>;})}</div><div className="totals">{totals(emp.id).map(t=><span key={t.s}><StatusDisplay status={t.s}/>: <b>{t.n}</b></span>)}</div></article>}</div>)}</div></>}
      {tab==="ot-calendar"&&<><div className="calendar-year-picker"><label>OT Calendar  <select value={year} onChange={e=>setMonth(new Date(Number(e.target.value),month.getMonth(),1))}>{Array.from({length:9},(_,i)=>new Date().getFullYear()-4+i).map(y=><option key={y} value={y}>{y}</option>)}</select></label><strong> Total OT: {yearOTTotal.toLocaleString("en-US")} Hours</strong></div><div className="employee-list calendar-employee-list">{filtered.map(emp=><div className="calendar-employee" key={emp.id}><button className={"calendar-employee-toggle "+(expandedCalendarEmployee===emp.id?"expanded":"")} onClick={()=>setExpandedCalendarEmployee(prev=>prev===emp.id?null:emp.id)}><span><b>{emp.employee_code}</b><strong>{emp.full_name}</strong></span><span>{expandedCalendarEmployee===emp.id?"Hide calendar":"View calendar"} <span className="toggle-mark">{expandedCalendarEmployee===emp.id?"−":"＋"}</span></span></button>{expandedCalendarEmployee===emp.id&&<article className="employee-year calendar-expanded"><div className="months">{years.map(i=>{const count=new Date(year,i+1,0).getDate();const offset=new Date(year,i,1).getDay();return <div className="mini-month" key={i}><b>{MONTHS[i]}</b><div className="days"><span className="weekday-label">Sun</span><span className="weekday-label">Mon</span><span className="weekday-label">Tue</span><span className="weekday-label">Wed</span><span className="weekday-label">Thu</span><span className="weekday-label friday-label">Fri</span><span className="weekday-label">Sat</span>{Array.from({length:offset},(_,n)=><span key={"blank"+n}/>)}{Array.from({length:count},(_,d)=>{const date=dateKey(new Date(year,i,d+1));const entry=overtimeLookup.get(emp.id+"|"+date);return <span title={date+(entry?" · "+entry.hours+" Hours":"")} className={(calendarTone(date,"")==="holiday"?"official-holiday-cell ":"")+"ot-calendar-hour"} key={d}><b className="ot-calendar-date">{d+1}</b>{entry&&<small className="ot-calendar-hours">{Number(entry.hours).toLocaleString("en-US")}h</small>}</span>;})}</div></div>;})}</div><div className="ot-employee-total"> Total OT: {overtimeEntries.filter(o=>o.employee_id===emp.id&&o.overtime_date>=yearFirst&&o.overtime_date<=yearLast).reduce((sum,o)=>sum+Number(o.hours||0),0).toLocaleString("en-US")} Hours</div></article>}</div>)}</div></>}
      {tab==="mine"&&<><div className="toolbar"><div className="month-nav"><button onClick={()=>setMonth(new Date(year,month.getMonth()-1,1))}><ChevronLeft/></button><b>{MONTHS[month.getMonth()]} {year}</b><button onClick={()=>setMonth(new Date(year,month.getMonth()+1,1))}><ChevronRight/></button></div></div><div className="employee-year"><h3>{selectedEmployeeRow?.full_name||profile.display_name||"My "} · {selectedEmployeeRow?.employee_code||""}</h3><div className="months">{years.map(i=><div className="mini-month" key={i}><b>{MONTHS[i]}</b><div className="days"><span className="weekday-label">Sun</span><span className="weekday-label">Mon</span><span className="weekday-label">Tue</span><span className="weekday-label">Wed</span><span className="weekday-label">Thu</span><span className="weekday-label friday-label">Fri</span><span className="weekday-label">Sat</span>{Array.from({length:new Date(year,i+1,0).getDate()},(_,d)=>{const date=dateKey(new Date(year,i,d+1));const st=lookup.get((profile.employee_id||"")+"|"+date)?.status||"";const otEntry=overtimeLookup.get((profile.employee_id||"")+"|"+date);const tone=calendarTone(date,st);return <span key={d} title={date+" "+(LABELS[st]||"")+(otEntry?" · OT "+otEntry.hours+" Hours":"")} className={(tone==="holiday"?"official-holiday-cell ":tone==="leave"?"personal-leave-cell ":"")+(st?"day-"+st.replace("/","-"):"")}>{st?<StatusDisplay status={st} overtimeHours={otEntry?.hours||0} tone={tone}/>:d+1}</span>;})}</div></div>)}</div><div className="totals">{totals(profile.employee_id||"").map(t=><span key={t.s}><StatusDisplay status={t.s}/>: <b>{t.n}</b></span>)}</div></div><h3>My Leave Records</h3><LeaveTable leaves={leaves.filter(l=>l.employee_id===profile.employee_id)} employeeMap={employeeMap}/></>}
      {tab==="employees"&&<><div className="toolbar"><div className="search"><Search/><input placeholder="Name  Control Number with " value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="actions"><label className="checkline"><input type="checkbox" checked={includeInactive} onChange={e=>setIncludeInactive(e.target.checked)}/> Include inactive</label><button onClick={exportEmployees}><Download/> CSV</button>{canManage&&<button className="primary" onClick={()=>{setEditingEmployee(null);setEmployeeForm({is_active:true});setShowEmployeeForm(true)}}><Plus/> Add Employee</button>}</div></div>
        <div className="employee-list">{filtered.map(emp=><div className="employee-row" key={emp.id}><div><b>{emp.employee_code} · {emp.full_name}</b><small>{emp.department||"—"} · {emp.designation||"—"} {emp.phone||""} {!emp.is_active?" · Inactive":""}</small></div><div className="actions">{emp.phone&&<a className="call" href={"tel:"+emp.phone}><Phone/> Call</a>}{canManage&&<button onClick={()=>editEmployee(emp)}><Pencil/> Edit</button>}</div></div>)}</div>
        {showEmployeeForm&&<div className="modal-backdrop"><form className="modal" onSubmit={saveEmployee}><div className="modal-head"><h2>{editingEmployee?" Data ":"Add Employee"}</h2><button type="button" onClick={()=>setShowEmployeeForm(false)}><X/></button></div><div className="form-grid">
          <Field label="Control Number"><input value={employeeForm.employee_code||""} onChange={e=>setEmployeeForm({...employeeForm,employee_code:e.target.value})}/></Field>
          <Field label=" Name *"><input required value={employeeForm.full_name||""} onChange={e=>setEmployeeForm({...employeeForm,full_name:e.target.value})}/></Field>
          <Field label="Department"><input value={employeeForm.department||""} onChange={e=>setEmployeeForm({...employeeForm,department:e.target.value})}/></Field>
          <Field label="Designation"><input value={employeeForm.designation||""} onChange={e=>setEmployeeForm({...employeeForm,designation:e.target.value})}/></Field>
          <Field label="Phone"><input value={employeeForm.phone||""} onChange={e=>setEmployeeForm({...employeeForm,phone:e.target.value})}/></Field>
          <Field label="Email"><input type="email" value={employeeForm.email||""} onChange={e=>setEmployeeForm({...employeeForm,email:e.target.value})}/></Field>
          <Field label="Joining "><input type="date" value={employeeForm.joining_date||""} onChange={e=>setEmployeeForm({...employeeForm,joining_date:e.target.value})}/></Field>
          <Field label="Emergency Contact"><input value={employeeForm.emergency_contact||""} onChange={e=>setEmployeeForm({...employeeForm,emergency_contact:e.target.value})}/></Field>
        </div><label className="checkline"><input type="checkbox" checked={employeeForm.is_active!==false} onChange={e=>setEmployeeForm({...employeeForm,is_active:e.target.checked})}/> Active Employee</label><div className="modal-actions"><button type="button" onClick={()=>setShowEmployeeForm(false)}>Cancel</button><button className="primary" disabled={busy}>Save</button></div></form></div>}
      </>}
      {tab==="leaves"&&<><div className="panel"><h3>{canManage?"Leave  ":"Leave  Submit Date"}</h3>{profile.role==="staff"&&<form onSubmit={submitLeave} className="form-grid"><Field label="Leave Type"><select value={leaveForm.leave_type} onChange={e=>setLeaveForm({...leaveForm,leave_type:e.target.value})}>{["C/L","O/L","S/L","H/L"].map(s=><option key={s} value={s}>{s} · {LABELS[s]}</option>)}</select></Field><Field label="Start "><input type="date" required value={leaveForm.start_date} onChange={e=>setLeaveForm({...leaveForm,start_date:e.target.value})}/></Field><Field label="End "><input type="date" required min={leaveForm.start_date} value={leaveForm.end_date} onChange={e=>setLeaveForm({...leaveForm,end_date:e.target.value})}/></Field><Field label="Reason"><input value={leaveForm.reason} onChange={e=>setLeaveForm({...leaveForm,reason:e.target.value})}/></Field><button className="primary" disabled={busy}> Submit Date</button></form>}</div>
        <LeaveTable leaves={canSeeAll?leaves:leaves.filter(l=>l.employee_id===profile.employee_id)} employeeMap={employeeMap} canReview={canManage} onReview={reviewLeave}/></>}
      {tab==="calendar"&&<>{canManage&&<div className="panel"><h3>Leave / Holiday / Weekly Off Add Please</h3><form className="form-grid" onSubmit={saveEvent}><Field label=""><input type="date" required value={eventForm.event_date} onChange={e=>setEventForm({...eventForm,event_date:e.target.value})}/></Field><Field label="Type"><select value={eventForm.event_type} onChange={e=>setEventForm({...eventForm,event_type:e.target.value})}><option value="HOLIDAY">Holiday / Public Leave</option><option value="WEEKLY_OFF">Weekly Off / Weekly Off</option><option value="NOTICE">Other Notice</option></select></Field><Field label="Title"><input required value={eventForm.title} onChange={e=>setEventForm({...eventForm,title:e.target.value})}/></Field><Field label="Description"><input value={eventForm.notes} onChange={e=>setEventForm({...eventForm,notes:e.target.value})}/></Field><button className="primary" disabled={busy}><Plus/> Event Add Please</button></form><p className="muted">Holiday Add When added All Active  to attendance H and Weekly Off Add When added W/O will be marked।</p></div>}<div className="employee-list">{events.map(ev=><div className="employee-row" key={ev.id}><div><b>{ev.event_date} · {ev.title}</b><small>{ev.event_type==="HOLIDAY"?"Holiday":ev.event_type==="WEEKLY_OFF"?"Weekly Off":"Notice"} · {ev.notes||""}</small></div>{canManage&&<button onClick={()=>void deleteEvent(ev.id)}><X/> Delete</button>}</div>)}</div></>}
      {tab==="access"&&canManage&&<><div className="panel"><h3>Add Access Profile Add / Update</h3><p className="muted">The user first Supabase Auth-in account create must be। Then their Auth User ID here with Employee and role assign Please।</p><form className="form-grid" onSubmit={saveAccess}><Field label="Supabase Auth User ID"><input required value={accessForm.user_id} onChange={e=>setAccessForm({...accessForm,user_id:e.target.value})} placeholder="UUID"/></Field><Field label="Name"><input value={accessForm.display_name} onChange={e=>setAccessForm({...accessForm,display_name:e.target.value})}/></Field><Field label="Role"><select value={accessForm.role} onChange={e=>setAccessForm({...accessForm,role:e.target.value})}><option value="staff">Staff · Own Data</option><option value="viewer">Viewer · Only View</option><option value="admin">Admin · Management</option></select></Field><Field label="Employee (Staff )"><select value={accessForm.employee_id} onChange={e=>setAccessForm({...accessForm,employee_id:e.target.value})}><option value="">Select Please</option>{employees.map(emp=><option key={emp.id} value={emp.id}>{emp.employee_code} · {emp.full_name}</option>)}</select></Field><button className="primary" disabled={busy}>Access Save</button></form></div><div className="employee-list">{users.map(u=><div className="employee-row" key={u.user_id}><div><b>{u.display_name||u.user_id}</b><small>{u.role} · {employeeMap.get(u.employee_id||"")?.full_name||"No Employee Add available"} · {u.user_id}</small></div><div className="actions">{u.user_id!==profile.user_id&&u.role!=="owner"&&<button onClick={()=>void removeAccess(u.user_id)}><X/> Remove</button>}{u.user_id!==profile.user_id&&u.role!=="owner"&&<button onClick={()=>setAccessForm({user_id:u.user_id,role:u.role,employee_id:u.employee_id||"",display_name:u.display_name||""})}><Pencil/> Edit</button>}</div></div>)}</div></>}
      {tab==="backups"&&canManage&&<><div className="panel"><h3>Database Backup</h3><p className="muted">Employee, , Leave  and Calendar  JSON Backup secure Private Storage-in stored be।</p><div className="actions"><button className="primary" disabled={busy} onClick={()=>void makeBackup()}><HardDrive/> Now Backup Create</button><label className="upload-btn"><Upload/> Backup Restore Please<input type="file" accept=".json,application/json" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void restoreBackup(f);e.currentTarget.value="";}}/></label></div></div><div className="employee-list">{backups.map(b=><div className="employee-row" key={b.id}><div><b>{b.file_name}</b><small>{new Date(b.created_at).toLocaleString("en-US")} · {(b.file_size/1024).toFixed(1)} KB</small></div><div className="actions"><button onClick={()=>void downloadBackup(b.storage_path,b.file_name)}><FileDown/> Download</button><button onClick={()=>void deleteBackup(b.id,b.storage_path)}><X/> Delete</button></div></div>)}{!backups.length&&<p className="muted pad">No No Backup available।</p>}</div></>}
      {noteViewer&&<div className="modal-backdrop" onClick={()=>setNoteViewer(null)}><section className="modal note-viewer" role="dialog" aria-modal="true" aria-label="Attendance note" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Attendance Note</h2><button type="button" onClick={()=>setNoteViewer(null)}><X/></button></div><p className="muted">{noteViewer.employee} · {noteViewer.date}</p><div className="note-viewer-text">{noteViewer.note}</div><div className="modal-actions"><button className="primary" onClick={()=>setNoteViewer(null)}>Close</button></div></section></div>}
      {noteEditor&&<div className="modal-backdrop" onClick={()=>setNoteEditor(null)}><section className="modal note-viewer" role="dialog" aria-modal="true" aria-label="Edit attendance note" onClick={e=>e.stopPropagation()}><div className="modal-head"><h2>Daily Note</h2><button type="button" onClick={()=>setNoteEditor(null)}><X/></button></div><p className="muted">{noteEditor.employee} · {noteEditor.date}</p><textarea className="note-editor-input" rows={5} autoFocus placeholder="Write note for this date..." value={draftDailyNotes[noteEditor.employeeId+"|"+noteEditor.date]??""} disabled={busy} onChange={e=>setDraftDailyNotes(prev=>({...prev,[noteEditor.employeeId+"|"+noteEditor.date]:e.target.value}))}/><div className="modal-actions"><button type="button" onClick={()=>setNoteEditor(null)}>Cancel</button><button type="button" className="primary" disabled={busy||((draftDailyNotes[noteEditor.employeeId+"|"+noteEditor.date]??"").trim()===(dailyNotes.find(n=>n.employee_id===noteEditor.employeeId&&n.note_date===noteEditor.date)?.note||""))} onClick={()=>void saveDailyNote(noteEditor.employeeId,noteEditor.date)}>Save Note</button></div></section></div>}
      <footer>Employee Attendance System · Secure access · Secure Attendance Workspace · Developed by Shovo Sarker</footer>
    </main>
  </div>;
}
function LeaveTable({leaves,employeeMap,canReview=false,onReview}:{leaves:Leave[];employeeMap:Map<string,Employee>;canReview?:boolean;onReview?:(id:string,status:string)=>void}){
  if(!leaves.length)return <div className="panel muted">No Leave Records available।</div>;
  return <div className="employee-list">{leaves.map(l=><div className="employee-row leave-row" key={l.id}><div><b>{employeeMap.get(l.employee_id)?.full_name||"Employee"} · {l.leave_type}</b><small>{l.start_date} → {l.end_date} · {l.reason||"Reason provided available"} · <span className={"leave-status "+l.status}>{l.status==="pending"?"Pending":l.status==="approved"?"Approved":"Rejected"}</span></small></div>{canReview&&l.status==="pending"&&<div className="actions"><button className="approve" onClick={()=>onReview?.(l.id,"approved")}><Check/> Approve</button><button className="reject" onClick={()=>onReview?.(l.id,"rejected")}><X/> Reject</button></div>}</div>)}</div>;
}
