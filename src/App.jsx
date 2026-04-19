import { BrowserRouter, Routes, Route } from 'react-router-dom';
import OfflineBanner from './components/OfflineBanner';
import Home from './pages/Home';
import NewSession from './pages/NewSession';
import SessionView from './pages/SessionView';
import UploadReceipts from './pages/UploadReceipts';
import ConfirmItems from './pages/ConfirmItems';
import ShareSession from './pages/ShareSession';
import WhoAreYou from './pages/WhoAreYou';
import JoiningScreen from './pages/JoiningScreen';
import ClaimItems from './pages/ClaimItems';
import ManagePeople from './pages/ManagePeople';
import MergePeople from './pages/MergePeople';
import Resolve from './pages/Resolve';
import Breakdown from './pages/Breakdown';
import Reconcile from './pages/Reconcile';
import MapPeople from './pages/MapPeople';
import ReconcileSettlement from './pages/ReconcileSettlement';
import Admin from './pages/Admin';
import ExistingSessions from './pages/ExistingSessions';

export default function App() {
  return (
    <BrowserRouter>
      <OfflineBanner />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/session/new" element={<NewSession />} />
        <Route path="/session/:sessionId" element={<SessionView />} />
        <Route path="/session/:sessionId/upload" element={<UploadReceipts />} />
        <Route path="/session/:sessionId/confirm" element={<ConfirmItems />} />
        <Route path="/session/:sessionId/share" element={<ShareSession />} />
        <Route path="/session/:sessionId/joining" element={<JoiningScreen />} />
        <Route path="/session/:sessionId/claim" element={<ClaimItems />} />
        <Route path="/session/:sessionId/manage-people" element={<ManagePeople />} />
        <Route path="/session/:sessionId/merge-people" element={<MergePeople />} />
        <Route path="/session/:sessionId/resolve" element={<Resolve />} />
        <Route path="/session/:sessionId/breakdown" element={<Breakdown />} />
        <Route path="/s/:sessionId" element={<WhoAreYou />} />
        <Route path="/reconcile" element={<Reconcile />} />
        <Route path="/reconcile/map-people" element={<MapPeople />} />
        <Route path="/reconcile/settlement" element={<ReconcileSettlement />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/existing-sessions" element={<ExistingSessions />} />
      </Routes>
    </BrowserRouter>
  );
}
