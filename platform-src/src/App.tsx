import { HashRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { AuthProvider, RequireRole, RequireAuth } from "./lib/auth";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import AdminLayout from "./layouts/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import Students from "./pages/admin/Students";
import Admissions from "./pages/admin/Admissions";
import Parents from "./pages/admin/Parents";
import ParentProfile from "./pages/admin/ParentProfile";
import Teachers from "./pages/admin/Teachers";
import StudentProfile from "./pages/admin/StudentProfile";
import TeacherProfile from "./pages/admin/TeacherProfile";
import Settings from "./pages/admin/Settings";
import CalendarAdmin from "./pages/admin/CalendarAdmin";
import AnnouncementsAdmin from "./pages/admin/AnnouncementsAdmin";
import Fees from "./pages/admin/Fees";
import ParentActivity from "./pages/admin/ParentActivity";
import AssignmentsAdmin from "./pages/admin/AssignmentsAdmin";
import ClassUpdates from "./pages/admin/ClassUpdates";
import RedComet from "./pages/admin/RedComet";
import Feedback from "./pages/admin/Feedback";
import Tasks from "./pages/admin/Tasks";
import TeacherRequests from "./pages/admin/TeacherRequests";
import SocialPosts from "./pages/admin/SocialPosts";
import Volunteers from "./pages/admin/Volunteers";
import Attendance from "./pages/admin/Attendance";
import MeetingsAdmin from "./pages/admin/Meetings";
import ReportAttendance from "./pages/admin/ReportAttendance";
import ReportFees from "./pages/admin/ReportFees";
import ReportActivity from "./pages/admin/ReportActivity";
import RedCometMessages from "./pages/admin/RedCometMessages";
import PageTracker from "./components/PageTracker";
import Meet from "./pages/Meet";
import TeacherMeetings from "./pages/teacher/Meetings";
import ParentHome from "./pages/parent/ParentHome";
import TeacherLayout from "./layouts/TeacherLayout";
import TeacherToday from "./pages/teacher/Today";
import TeacherStudent from "./pages/teacher/StudentDetail";
import TeacherUpdate from "./pages/teacher/Update";
import TeacherProgress from "./pages/teacher/Progress";
import TeacherMe from "./pages/teacher/Me";
import TeacherRequestsTab from "./pages/teacher/Requests";

// a crash on one page shows a Reload card instead of a blank screen; a new route starts clean
function PageGuard({ children }: { children: ReactNode }) {
  const loc = useLocation();
  return <ErrorBoundary resetKey={loc.pathname}>{children}</ErrorBoundary>;
}

// HashRouter so deep links work on GitHub Pages without server rewrites.
export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <PageGuard>
        <PageTracker />
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* parent-teacher meeting booking (phase 33): public, one link per class */}
          <Route path="/meet/:token" element={<Meet />} />
          <Route path="/change-password" element={<RequireAuth><ChangePassword /></RequireAuth>} />

          <Route path="/admin" element={<RequireRole roles={["admin", "staff"]}><AdminLayout /></RequireRole>}>
            <Route index element={<Dashboard />} />
            <Route path="students" element={<Students />} />
            <Route path="students/:id" element={<StudentProfile />} />
            <Route path="admissions" element={<Admissions />} />
            <Route path="volunteers" element={<Volunteers />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="parents" element={<Parents />} />
            <Route path="parents/:id" element={<ParentProfile />} />
            <Route path="teachers" element={<Teachers />} />
            <Route path="teachers/:id" element={<TeacherProfile />} />
            <Route path="fees" element={<Fees />} />
            <Route path="assignments" element={<AssignmentsAdmin />} />
            <Route path="updates" element={<ClassUpdates />} />
            <Route path="redcomet" element={<RedComet />} />
            <Route path="redcomet/messages" element={<RedCometMessages />} />
            <Route path="meetings" element={<MeetingsAdmin />} />
            <Route path="calendar" element={<CalendarAdmin />} />
            <Route path="announcements" element={<AnnouncementsAdmin />} />
            <Route path="feedback" element={<Feedback />} />
            <Route path="reports/attendance" element={<ReportAttendance />} />
            <Route path="reports/fees" element={<ReportFees />} />
            <Route path="reports/activity" element={<ReportActivity />} />
            <Route path="tasks" element={<Tasks />} />
            <Route path="teacher-requests" element={<TeacherRequests />} />
            <Route path="social" element={<SocialPosts />} />
            <Route path="parent-activity" element={<ParentActivity />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          <Route path="/parent" element={<RequireRole roles={["parent"]}><ParentHome /></RequireRole>} />

          {/* Teacher app (phase 26): mobile-first, installable */}
          <Route path="/teacher" element={<RequireRole roles={["teacher"]}><TeacherLayout /></RequireRole>}>
            <Route index element={<TeacherToday />} />
            <Route path="students/:id" element={<TeacherStudent />} />
            <Route path="update" element={<TeacherUpdate />} />
            <Route path="progress" element={<TeacherProgress />} />
            <Route path="meetings" element={<TeacherMeetings />} />
            <Route path="requests" element={<TeacherRequestsTab />} />
            <Route path="me" element={<TeacherMe />} />
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        </PageGuard>
      </HashRouter>
    </AuthProvider>
  );
}
