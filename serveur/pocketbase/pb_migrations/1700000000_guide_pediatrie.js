/// <reference path="../pb_data/types.d.ts" />
/* Guide de Pédiatrie — création automatique des tables PocketBase (v0.23 et plus récent).
   Copiez ce dossier pb_migrations à côté de l'exécutable pocketbase puis lancez :  ./pocketbase serve */
migrate((app) => {
  const users = app.findCollectionByNameOrId("users");
  users.fields.add(new TextField({ name: "nom", max: 80 }));
  users.fields.add(new TextField({ name: "prenom", max: 80 }));
  users.fields.add(new TextField({ name: "tel", max: 30 }));
  users.fields.add(new SelectField({ name: "profession", values: ["etudiant", "resident", "pediatre"], maxSelect: 1 }));
  users.fields.add(new BoolField({ name: "is_admin" }));
  users.indexes.push("CREATE UNIQUE INDEX idx_users_tel ON users (tel) WHERE tel != ''");
  users.passwordAuth.identityFields = ["email", "tel"];          // connexion par e-mail OU téléphone
  users.createRule = "@request.body.is_admin:isset = false";     // personne ne peut se déclarer admin
  users.listRule = "id = @request.auth.id || @request.auth.is_admin = true";
  users.viewRule = "id = @request.auth.id || @request.auth.is_admin = true";
  users.updateRule = "id = @request.auth.id && @request.body.is_admin:isset = false";
  users.deleteRule = null;
  app.save(users);

  const own = "user = @request.auth.id";
  for (const name of ["observations", "patients", "consultations", "entrainement", "examens", "presentations", "publications", "theses", "carnet", "evc", "cames", "notes", "coffre"]) {
    const c = new Collection({
      type: "base", name,
      listRule: (name === "examens" || name === "evc") ? "@request.auth.id != ''" : own,   // classement et banque EVC partagés
      viewRule: (name === "examens" || name === "evc") ? "@request.auth.id != ''" : own,
      createRule: "@request.auth.id != '' && @request.body.user = @request.auth.id" + (name === "evc" ? " && (@request.auth.profession = 'pediatre' || @request.auth.is_admin = true)" : ""),
      updateRule: own + " && (@request.body.user:isset = false || @request.body.user = @request.auth.id)",
      deleteRule: own,
      fields: [
        { name: "uid", type: "text", required: true, max: 64 },
        { name: "user", type: "relation", collectionId: users.id, maxSelect: 1, required: true, cascadeDelete: true },
        { name: "patient", type: "text", max: 64 },
        { name: "data", type: "json", maxSize: name === "evc" ? 120000 : 8000000 },
        { name: "created", type: "autodate", onCreate: true },
        { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
      ],
      indexes: [`CREATE UNIQUE INDEX idx_${name}_uid ON ${name} (user, uid)`],
    });
    app.save(c);
  }
}, (app) => {
  for (const name of ["observations", "patients", "consultations", "entrainement", "examens", "presentations", "publications", "theses", "carnet", "evc", "cames", "notes", "coffre"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (e) {}
  }
});
