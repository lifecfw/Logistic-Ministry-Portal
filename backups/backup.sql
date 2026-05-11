--
-- PostgreSQL database dump
--

-- Dumped from database version 16.10
-- Dumped by pg_dump version 17.5

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: auth_codes; Type: TABLE DATA; Schema: public; Owner: -
--

SET SESSION AUTHORIZATION DEFAULT;

ALTER TABLE public.auth_codes DISABLE TRIGGER ALL;

COPY public.auth_codes (user_id, code, user_data, created_at, expires_at, attempts) FROM stdin;
\.


ALTER TABLE public.auth_codes ENABLE TRIGGER ALL;

--
-- Data for Name: bank_owner; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.bank_owner DISABLE TRIGGER ALL;

COPY public.bank_owner (id, user_id, username, display_name, purchased_at) FROM stdin;
\.


ALTER TABLE public.bank_owner ENABLE TRIGGER ALL;

--
-- Data for Name: business_profit_log; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.business_profit_log DISABLE TRIGGER ALL;

COPY public.business_profit_log (id, user_id, business_id, business_type, amount, note, logged_at) FROM stdin;
\.


ALTER TABLE public.business_profit_log ENABLE TRIGGER ALL;

--
-- Data for Name: business_state; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.business_state DISABLE TRIGGER ALL;

COPY public.business_state (user_id, business_id, business_type, inventory_pct, last_refill_at, accumulated_profit, last_sync_at, weekly_bonus_at) FROM stdin;
\.


ALTER TABLE public.business_state ENABLE TRIGGER ALL;

--
-- Data for Name: customer_purchases; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.customer_purchases DISABLE TRIGGER ALL;

COPY public.customer_purchases (id, buyer_user_id, buyer_username, seller_user_id, business_id, business_type, item_name, price, purchased_at) FROM stdin;
\.


ALTER TABLE public.customer_purchases ENABLE TRIGGER ALL;

--
-- Data for Name: gang_log; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.gang_log DISABLE TRIGGER ALL;

COPY public.gang_log (id, gang_id, action, actor_username, details, logged_at) FROM stdin;
\.


ALTER TABLE public.gang_log ENABLE TRIGGER ALL;

--
-- Data for Name: gang_members; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.gang_members DISABLE TRIGGER ALL;

COPY public.gang_members (gang_id, user_id, username, display_name, role, joined_at) FROM stdin;
\.


ALTER TABLE public.gang_members ENABLE TRIGGER ALL;

--
-- Data for Name: gang_resources; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.gang_resources DISABLE TRIGGER ALL;

COPY public.gang_resources (gang_id, steel, aluminum, plastic, iron, coal, weapons) FROM stdin;
\.


ALTER TABLE public.gang_resources ENABLE TRIGGER ALL;

--
-- Data for Name: gang_sprays; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.gang_sprays DISABLE TRIGGER ALL;

COPY public.gang_sprays (id, gang_id, x, y, sprayed_at) FROM stdin;
\.


ALTER TABLE public.gang_sprays ENABLE TRIGGER ALL;

--
-- Data for Name: gang_treasury_log; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.gang_treasury_log DISABLE TRIGGER ALL;

COPY public.gang_treasury_log (id, gang_id, type, amount, actor_username, note, logged_at) FROM stdin;
\.


ALTER TABLE public.gang_treasury_log ENABLE TRIGGER ALL;

--
-- Data for Name: gang_weapons; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.gang_weapons DISABLE TRIGGER ALL;

COPY public.gang_weapons (id, gang_id, weapon_name, quantity, added_by, added_at) FROM stdin;
\.


ALTER TABLE public.gang_weapons ENABLE TRIGGER ALL;

--
-- Data for Name: gangs; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.gangs DISABLE TRIGGER ALL;

COPY public.gangs (id, name, president_id, president_username, president_display_name, vp_id, vp_username, vp_display_name, color, logo_base64, treasury, created_at, created_by, radius_pct) FROM stdin;
\.


ALTER TABLE public.gangs ENABLE TRIGGER ALL;

--
-- Data for Name: house_ownership; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.house_ownership DISABLE TRIGGER ALL;

COPY public.house_ownership (id, house_id, owner_user_id, owner_username, owner_display_name, purchased_at) FROM stdin;
\.


ALTER TABLE public.house_ownership ENABLE TRIGGER ALL;

--
-- Data for Name: house_rental_bookings; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.house_rental_bookings DISABLE TRIGGER ALL;

COPY public.house_rental_bookings (id, listing_id, house_id, renter_user_id, renter_username, renter_display_name, days, daily_price, total_price, started_at, expires_at, is_active) FROM stdin;
\.


ALTER TABLE public.house_rental_bookings ENABLE TRIGGER ALL;

--
-- Data for Name: house_rental_listings; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.house_rental_listings DISABLE TRIGGER ALL;

COPY public.house_rental_listings (id, house_id, owner_user_id, owner_username, owner_display_name, daily_price, is_available, notes, updated_at) FROM stdin;
\.


ALTER TABLE public.house_rental_listings ENABLE TRIGGER ALL;

--
-- Data for Name: house_rental_profit_log; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.house_rental_profit_log DISABLE TRIGGER ALL;

COPY public.house_rental_profit_log (id, owner_user_id, house_id, amount, note, logged_at) FROM stdin;
\.


ALTER TABLE public.house_rental_profit_log ENABLE TRIGGER ALL;

--
-- Data for Name: house_rental_state; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.house_rental_state DISABLE TRIGGER ALL;

COPY public.house_rental_state (house_id, owner_user_id, accumulated_profit) FROM stdin;
\.


ALTER TABLE public.house_rental_state ENABLE TRIGGER ALL;

--
-- Data for Name: known_users; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.known_users DISABLE TRIGGER ALL;

COPY public.known_users (user_id, username, display_name, avatar_url, last_seen_at) FROM stdin;
1327699415372398696	n16q	ま AF | khaled CL-1	https://cdn.discordapp.com/avatars/1327699415372398696/e74687d6e5c9ea991cacfbd7b3398ca7.png?size=128	1778505179765
\.


ALTER TABLE public.known_users ENABLE TRIGGER ALL;

--
-- Data for Name: manufacture_resources; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.manufacture_resources DISABLE TRIGGER ALL;

COPY public.manufacture_resources (user_id, discord_username, steel, aluminum, plastic, iron, coal, last_mined_at, weapon_count) FROM stdin;
\.


ALTER TABLE public.manufacture_resources ENABLE TRIGGER ALL;

--
-- Data for Name: manufacture_tables; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.manufacture_tables DISABLE TRIGGER ALL;

COPY public.manufacture_tables (user_id, purchased_at) FROM stdin;
\.


ALTER TABLE public.manufacture_tables ENABLE TRIGGER ALL;

--
-- Data for Name: manufacture_weapons; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.manufacture_weapons DISABLE TRIGGER ALL;

COPY public.manufacture_weapons (user_id, crafted_at) FROM stdin;
\.


ALTER TABLE public.manufacture_weapons ENABLE TRIGGER ALL;

--
-- Data for Name: marketplace_listings; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_listings DISABLE TRIGGER ALL;

COPY public.marketplace_listings (id, seller_user_id, seller_username, seller_display_name, item_type, item_name, quantity, price, description, status, created_at, sold_at) FROM stdin;
\.


ALTER TABLE public.marketplace_listings ENABLE TRIGGER ALL;

--
-- Data for Name: marketplace_transactions; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_transactions DISABLE TRIGGER ALL;

COPY public.marketplace_transactions (id, listing_id, buyer_user_id, buyer_username, buyer_display_name, seller_user_id, seller_username, item_type, item_name, quantity, price, payment_status, bought_at) FROM stdin;
\.


ALTER TABLE public.marketplace_transactions ENABLE TRIGGER ALL;

--
-- Data for Name: msg_chats; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.msg_chats DISABLE TRIGGER ALL;

COPY public.msg_chats (chat_key, id, from_id, to_id, content, type, sender_name, created_at) FROM stdin;
\.


ALTER TABLE public.msg_chats ENABLE TRIGGER ALL;

--
-- Data for Name: msg_config; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.msg_config DISABLE TRIGGER ALL;

COPY public.msg_config (key, value) FROM stdin;
next_phone	1001
\.


ALTER TABLE public.msg_config ENABLE TRIGGER ALL;

--
-- Data for Name: msg_groups; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.msg_groups DISABLE TRIGGER ALL;

COPY public.msg_groups (id, name, avatar_base64, admin_id, members, created_at) FROM stdin;
\.


ALTER TABLE public.msg_groups ENABLE TRIGGER ALL;

--
-- Data for Name: msg_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.msg_profiles DISABLE TRIGGER ALL;

COPY public.msg_profiles (user_id, phone, name, family_name, bio, avatar_base64, username, display_name, updated_at) FROM stdin;
\.


ALTER TABLE public.msg_profiles ENABLE TRIGGER ALL;

--
-- Data for Name: tw_notifications; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.tw_notifications DISABLE TRIGGER ALL;

COPY public.tw_notifications (id, type, from_user_id, to_user_id, tweet_id, created_at, read) FROM stdin;
\.


ALTER TABLE public.tw_notifications ENABLE TRIGGER ALL;

--
-- Data for Name: tw_profiles; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.tw_profiles DISABLE TRIGGER ALL;

COPY public.tw_profiles (user_id, discord_username, username, display_name, bio, avatar_base64, header_base64, verified, password, fake_follower_count, followers, following, created_at) FROM stdin;
\.


ALTER TABLE public.tw_profiles ENABLE TRIGGER ALL;

--
-- Data for Name: tw_tweets; Type: TABLE DATA; Schema: public; Owner: -
--

ALTER TABLE public.tw_tweets DISABLE TRIGGER ALL;

COPY public.tw_tweets (id, author_id, content, image_base64, likes, retweeted_by, reply_to, retweet_of, created_at) FROM stdin;
\.


ALTER TABLE public.tw_tweets ENABLE TRIGGER ALL;

--
-- Name: bank_owner_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.bank_owner_id_seq', 1, false);


--
-- Name: business_profit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.business_profit_log_id_seq', 1, false);


--
-- Name: customer_purchases_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.customer_purchases_id_seq', 1, false);


--
-- Name: gang_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gang_log_id_seq', 1, false);


--
-- Name: gang_sprays_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gang_sprays_id_seq', 1, false);


--
-- Name: gang_treasury_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gang_treasury_log_id_seq', 1, false);


--
-- Name: gang_weapons_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.gang_weapons_id_seq', 1, false);


--
-- Name: house_ownership_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.house_ownership_id_seq', 1, false);


--
-- Name: house_rental_bookings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.house_rental_bookings_id_seq', 1, false);


--
-- Name: house_rental_listings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.house_rental_listings_id_seq', 1, false);


--
-- Name: house_rental_profit_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.house_rental_profit_log_id_seq', 1, false);


--
-- Name: marketplace_listings_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.marketplace_listings_id_seq', 1, false);


--
-- Name: marketplace_transactions_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.marketplace_transactions_id_seq', 1, false);


--
-- PostgreSQL database dump complete
--

