import React from 'react';
import { Link } from 'react-router-dom';
import { Heart, MessageSquare, Sparkles, Users } from 'lucide-react';
import { useAuth } from '../lib/client';
import { useDocumentTitle } from '../lib/siteConfig';
import { RequestsPage } from './RequestsPage';

export function CommunityPage() {
  useDocumentTitle('Communauté');
  const { isMember } = useAuth();

  return (
    <main className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6 sm:py-10">
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <MessageSquare className="size-3.5" />
              <span>Espace Communauté</span>
            </div>
            <h1 className="mt-1 font-display text-3xl font-bold text-foreground sm:text-4xl">
              Communauté
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Proposez de nouveaux titres à ajouter, soutenez les demandes des autres membres et explorez la sélection communautaire.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Link
            to="/suggestion"
            className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/70 hover:bg-accent/40"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-primary">
                <Sparkles className="size-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                  Suggestion au hasard
                </h2>
                <p className="text-xs text-muted-foreground">
                  Trouvez quoi regarder en un clic
                </p>
              </div>
            </div>
          </Link>

          <Link
            to={isMember ? '/profil' : '/auth'}
            className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/70 hover:bg-accent/40"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-primary">
                <Users className="size-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                  {isMember ? 'Amis & activité' : 'Rejoindre les membres'}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {isMember
                    ? 'Ajoutez des amis et partagez vos visionnages'
                    : 'Connectez-vous pour voter, commenter et signaler'}
                </p>
              </div>
            </div>
          </Link>

          <Link
            to={isMember ? '/favoris' : '/catalogue'}
            className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/70 hover:bg-accent/40"
          >
            <div className="flex items-center gap-3">
              <div className="grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-background text-primary">
                <Heart className="size-5" />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-base font-semibold text-foreground group-hover:text-primary transition-colors">
                  {isMember ? 'Ma liste & favoris' : 'Parcourir le catalogue'}
                </h2>
                <p className="text-xs text-muted-foreground">
                  {isMember
                    ? 'Retrouvez vos favoris et vos 6 dernières lectures'
                    : 'Films, séries, animes et commentaires en ligne'}
                </p>
              </div>
            </div>
          </Link>
        </div>
      </section>

      <RequestsPage embedded />
    </main>
  );
}
