import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, RequireRole, RequireAuth } from "./lib/auth";
import Login from "./pages/Login";
import ChangePassword from "./pages/ChangePassword";
import AdminLayout from "./layouts/AdminLayout";
import Dashboard from "./pages/admin/Dashboard";
import Students from "./pages/admin/Students";
import Admissions from "./pages/admin/Admissions";
import Parents from "./pages/admin/Parents";
import Teachers from "./pages/admin/Teachers";
import StudentProfile from "./pages/admin/StudentProfile";
import TeacherProfile from "./pages/admin/TeacherProfile";
import Settings from "./pages/admin/Settings";
import CalendarAdmin from "./pages/admin/CalendarAdmin";
import AnnouncementsAdmin from "./pages/admin/AnnouncementsAdmin";
import Fees from "./pages/admin/Fees";
import Academics from "./pages/admin/Academics";
import Reports from "./pages/admin/Reports";
import AssignmentsAdmin from "./pages/admin/AssignmentsAdmin";
import ClassUpdates from "./pages/admin/ClassUpdates";
import ParentHome from "./pages/parent/ParentHome";

// HashRouter so deep links work on GitHub Pages without server rewrites.
export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/change-password" element={<RequireAuth><ChangePassword /></RequireAuth>} />

          <Route path="/admin" element={<RequireRole roles={["admin"]}><AdminLayout /></RequireRole>}>
            <Route index element={<Dashboard />} />
            <Route path="students" element={<Students />} />
            <Route path="students/:id" element={<StudentProfile />} />
            <Route path="admissions" element={<Admissions />} />
            <Route path="parents" element={<Parents />} />
            <Route path="teachers" element={<Teachers />} />
            <Route path="teachers/:id" element={<TeacherProfile />} />
            <Route path="fees" element={<Fees />} />
            <Route path="academics" element={<Academics />} />
            <Route path="assignments" element={<AssignmentsAdmin />} />
            <Route path="updates" element={<ClassUpdates />} />
            <Route path="calendar" element={<CalendarAdmin />} />
            <Route path="announcements" element={<AnnouncementsAdmin />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          <Route path="/parent" element={<RequireRole roles={["parent"]}><ParentHome /></RequireRole>} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
