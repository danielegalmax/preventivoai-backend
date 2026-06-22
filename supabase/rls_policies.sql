-- RLS Policy Baseline — PreventivoAI
-- Esportato il 2026-06-22 da Supabase dashboard
-- Applicare su un progetto nuovo: eseguire questo file nell'SQL Editor di Supabase
-- ATTENZIONE: non eseguire su un progetto esistente senza verificare conflitti

CREATE POLICY "utente vede i propri" ON public.abbonamenti FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "utenti vedono solo il proprio uso AI" ON public.ai_usage FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "Utente vede solo i suoi clienti" ON public.clienti FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "utenti vedono solo i propri eventi" ON public.eventi FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "utenti vedono solo i propri metodi" ON public.metodi_pagamento FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "notifiche_insert_own" ON public.notifiche FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "notifiche_select_own" ON public.notifiche FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "notifiche_update_own" ON public.notifiche FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "Utente gestisce i suoi preventivi" ON public.preventivi FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "preventivo_invii_insert_own" ON public.preventivo_invii FOR INSERT TO public WITH CHECK ((auth.uid() = user_id));
CREATE POLICY "preventivo_invii_select_own" ON public.preventivo_invii FOR SELECT TO public USING ((auth.uid() = user_id));
CREATE POLICY "preventivo_invii_update_own" ON public.preventivo_invii FOR UPDATE TO public USING ((auth.uid() = user_id));
CREATE POLICY "preventivo_invii_eventi_insert" ON public.preventivo_invii_eventi FOR INSERT TO public WITH CHECK ((EXISTS ( SELECT 1 FROM preventivo_invii i WHERE ((i.id = preventivo_invii_eventi.invio_id) AND (i.user_id = auth.uid())))));
CREATE POLICY "preventivo_invii_eventi_select" ON public.preventivo_invii_eventi FOR SELECT TO public USING ((EXISTS ( SELECT 1 FROM preventivo_invii i WHERE ((i.id = preventivo_invii_eventi.invio_id) AND (i.user_id = auth.uid())))));
CREATE POLICY "Trigger può inserire profilo" ON public.profiles FOR INSERT TO public WITH CHECK ((auth.uid() = id));
CREATE POLICY "Utente aggiorna solo il suo profilo" ON public.profiles FOR UPDATE TO public USING ((auth.uid() = id));
CREATE POLICY "Utente vede solo il suo profilo" ON public.profiles FOR SELECT TO public USING ((auth.uid() = id));
CREATE POLICY "Utente vede solo i suoi profili fiscali" ON public.profili_fiscali FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "utente vede le proprie rate" ON public.rate_abbonamento FOR ALL TO public USING ((abbonamento_id IN ( SELECT abbonamenti.id FROM abbonamenti WHERE (abbonamenti.user_id = auth.uid()))));
CREATE POLICY "utenti vedono solo le proprie segnalazioni" ON public.segnalazioni FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "Utente vede solo i suoi servizi" ON public.servizi FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "utenti vedono solo la propria sessione" ON public.sessioni FOR ALL TO public USING ((auth.uid() = user_id));
CREATE POLICY "Utente vede solo le sue trascrizioni" ON public.trascrizioni FOR ALL TO public USING ((auth.uid() = user_id));
