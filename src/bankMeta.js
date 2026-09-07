/* Red Pen's subject keys -> the subject strings used in the question bank.
   Maths Ext 1 has no bank questions; null means "no bank for this subject".

   This lives apart from questionData.js on purpose: App.jsx needs the mapping
   on first paint, but must not pull the 1.1MB question set into the initial
   bundle. questionData.js (and the ~1.1MB import) loads only when the Question
   bank or Practice test view is opened. */
export const BANK_SUBJECT = {
  chemistry: "Chemistry",
  physics: "Physics",
  mathsExt1: null,
};
