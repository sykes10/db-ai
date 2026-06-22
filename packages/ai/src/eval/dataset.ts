import type { EvalCase } from "./types.js";

/**
 * Starter eval set for the Pagila sample database.
 *
 * `value`/`rows` checks use figures verified against a live Pagila instance and
 * stable across standard Pagila/Sakila. Cases without a check are scored on table
 * selection and whether the generated SQL executes.
 */
export const PAGILA_EVAL_CASES: EvalCase[] = [
  {
    id: "count-films",
    question: "How many films are in the database?",
    expectedTables: ["film"],
    expect: { value: 1000 },
  },
  {
    id: "count-actors",
    question: "How many actors are there?",
    expectedTables: ["actor"],
    expect: { value: 200 },
  },
  {
    id: "count-categories",
    question: "How many film categories exist?",
    expectedTables: ["category"],
    expect: { value: 16 },
  },
  {
    id: "count-customers",
    question: "How many customers are registered?",
    expectedTables: ["customer"],
    expect: { value: 599 },
  },
  {
    id: "count-languages",
    question: "How many languages are available?",
    expectedTables: ["language"],
    expect: { value: 6 },
  },
  {
    id: "count-cities",
    question: "How many cities are in the database?",
    expectedTables: ["city"],
    expect: { value: 600 },
  },
  {
    id: "count-countries",
    question: "How many countries are there?",
    expectedTables: ["country"],
    expect: { value: 109 },
  },
  {
    id: "films-per-category",
    question: "How many films are in each category?",
    expectedTables: ["film_category", "category"],
    expect: { rows: 16 },
  },
  {
    id: "pg13-films",
    question: "List all films rated PG-13.",
    expectedTables: ["film"],
  },
  {
    id: "actor-most-films",
    question: "Which actor has appeared in the most films?",
    expectedTables: ["actor", "film_actor"],
  },
  {
    id: "action-films",
    question: "Which films are in the Action category?",
    expectedTables: ["film", "film_category", "category"],
  },
  {
    id: "customer-rental-counts",
    question: "How many rentals has each customer made?",
    expectedTables: ["rental", "customer"],
  },
  {
    id: "customers-by-city",
    question: "List customers along with the city they live in.",
    expectedTables: ["customer", "address", "city"],
  },
  {
    id: "never-rented-films",
    question: "Which films have never been rented?",
    expectedTables: ["film", "inventory", "rental"],
  },
  {
    id: "avg-rental-rate",
    question: "What is the average rental rate of films?",
    expectedTables: ["film"],
  },
  {
    id: "total-payments",
    question: "What is the total amount of all payments?",
    expectedTables: ["payment"],
  },
];
