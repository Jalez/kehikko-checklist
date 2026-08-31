/**
 * The screen for "nothing said which project this is", which is not an error.
 *
 * ## Why this screen exists at all
 *
 * This app's store moved into the project — `<projectPath>/.kehikot/checklist/checklists.json`
 * — so a checklist has nowhere to live until something says which project is
 * open. `roadmap.context.projectPath` is nullable and is null in two perfectly
 * ordinary situations: nothing is framing this page, or a host knows the
 * project's NAME and has no folder on this machine to point at.
 *
 * The alternatives to saying so were both available and both worse:
 *
 * - **An empty container.** "No project is open" and "this project has no checklists
 *   yet" would look identical, and the second has a button on it. A reader who
 *   pressed Start a checklist and watched nothing happen would learn that this
 *   app is broken, when in fact it is waiting to be told where it is.
 * - **A guess** — this app's own folder, the working directory, the last project
 *   somebody looked at. That writes a person's list into a repository they will
 *   never open, under a screen saying it was saved. `store.ts` refuses to have a
 *   fallback for exactly this reason, and this component is the other half of
 *   that refusal: the store will not guess, so the page has to say so.
 *
 * ## It offers nothing to press
 *
 * Deliberately. A picker here — "which project did you mean?" — would be this
 * page deciding where it is standing, which is the thing it has just said it
 * cannot know. What it can do is name the one fact that would fix it, which is
 * that a host has to open a project.
 */
export function Nowhere({ unhosted, project }: { unhosted: boolean; project: string | null }) {
  return (
    <section data-nowhere="yes" className="flex min-w-0 flex-col gap-1.5">
      <h2 className="text-[0.8rem] font-semibold">
        {unhosted ? 'Nothing is framing this page' : 'No project is open'}
      </h2>
      <p className="text-[0.7rem] leading-4 text-muted-foreground">
        {unhosted
          ? 'Opened directly, this page has no canvas to tell it which project it is standing in. Checklists are kept '
            + 'inside the project they are about — in a .kehikot folder there, as plain JSON — so there is nowhere to '
            + 'read from and nowhere to write to until a host says where that project is.'
          : project
            ? `This canvas says the project is called “${project}” but did not say where it is on this machine. `
              + 'Checklists are kept inside the project, in a .kehikot folder there, so a name alone is not enough to '
              + 'open one — and this container will not guess, because a guess writes somebody’s list into a folder they '
              + 'will never look in.'
            : 'Nothing on this canvas says which project is open. Checklists are kept inside the project they are '
              + 'about — in a .kehikot folder there, as plain JSON, beside the work — so there is nothing to show and '
              + 'nothing to write until one is.'}
      </p>
      <p className="text-[0.65rem] leading-4 text-muted-foreground">
        Nothing has been lost and nothing has been written. Open a project and its checklists appear.
      </p>
    </section>
  )
}
