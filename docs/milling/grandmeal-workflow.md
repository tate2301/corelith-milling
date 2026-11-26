# Grandmeal workflow pipeline

The operating spec for the Grandmeal mill (24 Nov 2026, from Tatenda). Where
this file and older mill docs or the design canvas disagree, **this file
wins**. `grandmeal-plan.md` maps each rule to the code that enforces it.

## Overview

Grandmeal runs on one chain:
1. Production makes bags by batch.
2. Marketing and sales turn orders into trips.
3. The rep delivers.
4. Accounting closes each delivery once the money is in.

Stock and Books move together at every step, and every change is logged.
Bags only change hands at the truck and at the customer, so stock stays
exact. Factory shop sales post straight from finished stock, as they would at
any till.

## Workspace setup

Grandmeal makes everything it sells, so the workspace runs as a manufacturer:
finished stock comes from its own production runs, never from a purchase
order.

| Setting | Grandmeal value |
| --- | --- |
| Product categories | Finished goods · Raw materials · Packaging · Fuel and consumables |
| Finished goods supplier | Grandmeal (own production). The field is fixed and hidden; finished goods get no purchase orders |
| Raw material suppliers | Normal supplier records, purchase orders and bills |
| Customer ID check | Off |
| Products | Mealie meal 5 kg, 10 kg, 20 kg and 50 kg, each with its own barcode |
| Units | Bags for finished goods · kg or tonnes for maize · units for packaging · litres for fuel |
| Batch tracking | On for finished goods. Batch number and date produced are required at production; the batch is required at dispatch |
| Issue rule | Oldest batch first, by date produced |
| Stock locations | Factory store · Factory shop · one location per truck |
| Order quantities | Bags or tonnes. 1 t = 200 bags of 5 kg, 100 of 10 kg, 50 of 20 kg or 20 of 50 kg |

### Cost treatment

Every raw material, packaging item and consumable carries a cost treatment.
None can be saved without one. Only accounting sets or changes it.

| Treatment | Where it lands in profit and loss |
| --- | --- |
| Cost of sales | Rolled into the cost of each bag; reduces gross profit |
| Operating expense | Below gross profit; reduces net profit |
| Asset | Stays on the balance sheet until used |

| Item | Treatment |
| --- | --- |
| Maize | Cost of sales |
| Packaging | Cost of sales |
| Fuel issued to the mill | Cost of sales |
| Fuel issued to the generator | Cost of sales |
| Fuel issued to a truck | Operating expense (distribution) |
| Damaged bags written off | Operating expense |

Net profit = sales, less discounts, less cost of sales, less operating
expenses.

Fuel is always issued to a named machine (a truck, the mill or the
generator), and the machine sets the treatment.

## Stage 1: Production to finished stock

One production entry turns raw materials into bags of finished stock. Stock
and the books update together.

1. Stores receives raw materials against a supplier bill: maize in kg,
   packaging in units, fuel in litres. Stock and the supplier balance go up.
2. Production opens a run: product, bags made, batch number, date produced.
   The product is scanned by its barcode (5 kg or 10 kg) or picked from the
   list. Example: Clement records 200 bags of Mealie meal 5 kg under one
   batch number and today's date.
3. The system deducts the inputs from that product's recipe: maize per bag
   and packaging per bag. Fuel is not on the recipe; it is issued to the mill
   or the generator as it is used.
4. The 200 bags land in Factory store under that batch. They show at once in
   the factory shop and in order lines.
5. If the maize actually used differs from the recipe, production enters the
   actual figure. The difference is kept as yield variance.

A run will not post if an input would go below zero. It names the short
input, and stores fixes the receipt first.

Grandmeal supplies a recipe for each product. Bag cost is the sum of the
inputs whose treatment is cost of sales, so the shop and every sale know the
cost of the bag sold.

## Stage 2: Orders, from marketing to sales

Marketing logs the orders it wins; sales works each one through to delivery.

1. A marketing agent logs the order: customer (existing or new), product,
   quantity in bags or tonnes, and the requested date. The agent is recorded
   on the order and stays on it through dispatch and reports.
2. The order lands as Pending, and the accountant assigns it to a sales rep.
3. The rep pursues the customer and moves the order to Ongoing once it is
   confirmed and being scheduled.
4. The order goes on a trip (Stage 3). On delivery, the rep marks it Complete
   (Stage 4).
5. Accounting closes it once the money is in (Stage 6).

| Status | Means | Set by |
| --- | --- | --- |
| Pending | Logged, not yet worked | The system, when marketing logs it |
| Ongoing | Customer confirmed; being scheduled or on a truck | Sales rep |
| Complete | Bags handed over; delivered quantity recorded | Sales rep |
| Closed | Money received and confirmed | Accounting only |
| Cancelled | Will not go ahead; a reason is required | Sales rep or accounting |

A customer with an unpaid balance cannot be given a new order or sale until
that balance is cleared.

### Discount vouchers

A voucher belongs to one customer. It is a percentage off, an amount off per
bag, or a fixed amount, with an expiry date and a use limit.

- One voucher per customer. A second cannot be issued until the first is
  used or has expired.
- The voucher applies to an order line, never to the total after the fact.
- Books shows gross sales and discounts given as separate lines, so
  discounts never hide inside revenue.

## Stage 3: Delivery planning and dispatch

A trip is one truck leaving the factory. The manager plans it, the
accountant assigns orders to it, stores loads it, and security clears it out
and back in at the gate.

1. The manager plans the trip: truck, driver, sales rep, route, dispatch
   date.
2. The accountant assigns Ongoing orders on that route to the trip as
   deliveries. A delivery is one order's full allocation for one customer,
   such as 100 bags, not a single sale.
3. The manager adds spare bags for route sales, per product, if the rep is to
   sell along the way.
4. Stores loads the truck: it scans each product barcode and records the
   batch numbers released. The system proposes the oldest batch first. The
   load must equal the deliveries plus the spares.
5. The driver logs in and records fuel, odometer reading and time out. Fuel
   issued to the truck is recorded against it.
6. Security checks the truck at the gate and approves it in the guard app.
   Only then does the trip go Out: the bags move from Factory store to the
   truck, and they are still Grandmeal's stock.
7. Back at the factory, the driver records fuel, odometer reading and time
   in. Security approves the return, and the trip goes Returned. Distance and
   fuel used come from the two sets of readings.

Dispatch writes one log entry per delivery: trip, truck, driver, route,
customer, marketing agent, sales rep, product, quantity, batch numbers, the
driver's readings, and security's approvals out and in. The trip links to the
truck's tracker in transport and telematics.

## Stage 4: On the route

The rep's terminal shows only that rep's trip: the route, customers in stop
order, bags per delivery, and spare bags left on the truck. It works offline
and syncs when signal returns, because rural routes drop out.

| Action | What the rep records | What it changes |
| --- | --- | --- |
| Deliver | Bags handed over (full or fewer), payment taken and method | Delivery marked Complete; a sale posts for the bags delivered |
| Route sale | Customer, product, bags, payment | A sale against the trip; spare bags drop |
| New customer | Name, phone, location | Customer saved as added by that rep on that trip; can be sold to at once |
| Apply voucher | Voucher for that customer | Discount on the line; one voucher per customer |

The rep cannot see other reps' trips, bag cost, margins or any accounting
page.

Any payment method is accepted on the route. If a credit customer still owes
on an earlier sale, the terminal blocks a new sale to them until it is paid.

## Stage 5: Returns and short deliveries

When a customer takes fewer bags than ordered, the shortfall comes back on the
truck, and the trip must balance before it closes.

Once security clears the truck back in, stores counts the bags back by product
and batch. The trip balances when:

> loaded = delivered + route sales + returned + damaged + missing

| Case | What happens |
| --- | --- |
| Customer took fewer bags | The rep records the delivered quantity, and the sale posts for that quantity only. The order shows the shortfall, and the rep picks Close short or Deliver balance later |
| Bags back in store | Stores scans them in. They move from the truck back to Factory store under the same batch. There was no sale, so there is nothing to reverse |
| Damaged bags | Written off with a reason; the treatment follows the cost settings |
| Missing bags | Flagged against the trip, driver and rep. Accounting decides how to settle them |
| Customer sends bags back after a sale | Accounting raises a credit note. The bags go back to store or are written off |

Accounting sees every shortfall and return in one list, with the trip,
customer and rep, before anything closes.

## Stage 6: Close-out by accounting

A delivery closes only when accounting has the money. The rep marks it
Complete; accounting confirms payment and closes it.

1. Completed deliveries land in accounting's Awaiting close list, with the
   amount due, any voucher applied and the payments the rep recorded.
2. The accountant matches each payment to what reached the bank, EcoCash or
   the cash banked.
3. Fully paid: the accountant closes the delivery. An order closes when all
   its deliveries are closed.
4. Paid short or on credit: the delivery stays Complete, and the balance stays
   in receivables ageing until it is paid. The customer can take no new order
   or sale until then.
5. The trip closes once it balances and every delivery on it is either closed
   or on account.

A closed record is locked. Any change after that goes through a reversal,
under the Books rules: the owner and the outside accountant can void;
internal accountants cannot.

## What each event posts

Every stock movement that touches money posts to Books by itself; nobody
re-keys a sale or a production run into the accounts.

| Event | Stock | Books |
| --- | --- | --- |
| Raw materials received | Maize, packaging and fuel up | Inventory up; supplier balance up |
| Supplier paid | None | Supplier balance down; bank down |
| Production run posted | Inputs down; bags up under the batch | Finished goods up by bag cost; maize and packaging down |
| Trip dispatched | Store to truck | None; the stock is still owned |
| Delivery complete, route sale or shop sale | Bags down | Sales and receivable (or cash) up; cost of sales up, finished goods down |
| Voucher applied | None | Discounts given up; receivable down |
| Payment confirmed | None | Bank or EcoCash up; receivable down |
| Bags back from a trip | Truck to store | None; they were never sold |
| Credit note after a sale | Bags back or written off | Sales returns up; receivable down; cost of sales reversed |
| Damaged bags written off | Bags down | Write-off expense up; finished goods down |
| Fuel issued to a machine | Fuel down | Truck: distribution expense up. Mill or generator: cost of sales up |

Profit and loss then reads in steps:
- sales less discounts is net sales;
- net sales less cost of sales is gross profit;
- gross profit less operating expenses (truck fuel, write-offs) is net
  profit.

## Permissions

Only accounting sees and changes money records. Every other role sees the
operational side of its own work and nothing more.

| Role | Can | Cannot |
| --- | --- | --- |
| Owner | Everything, including void and reversal | None |
| Outside accountant (auditor) | Same rights as the owner | None |
| Accountant | All money pages; assign orders to reps and to trips; close deliveries; set cost treatments; credit notes; settle returns and missing bags | Void posted records |
| Manager | Plan trips: truck, driver, rep, route, spare bags | Change prices or money records |
| Production | Record production runs, batch numbers, actual usage | See costs or accounts |
| Stores | Receive raw materials; issue fuel to machines; load and release batches; count returns; stock counts | Change prices or costs |
| Marketing agent | Log orders and customers; see the status of its own orders | Change status after Pending; see accounts |
| Sales rep | See assigned orders and trips; set Ongoing and Complete; record sales; add customers; issue one voucher per customer | Close orders; see cost, margin, accounts or other reps' trips |
| Driver | See own trips; record fuel, odometer and time out and in | See sales, customers' balances or accounts |
| Security | Approve trucks out and back in at the gate, in the guard app | Change trips, stock or readings |

## Audit trail and reports

Every create, change and status move is logged with who, when, which device,
and the old and new value. The log is append-only: nobody edits or deletes
it, the owner included. The owner and accounting can read it.

| Report | Shows | For |
| --- | --- | --- |
| Daily summary | Bags produced, dispatched and sold; cash received; stock on hand by product | Owner, accounting |
| Stock on hand | Bags by product, batch, location and age | Stores, accounting |
| Batch trace | One batch to its trips and customers | Owner, accounting, stores |
| Raw material usage | Actual against recipe, per run and per period | Production, accounting |
| Dispatch log | Every delivery with customer, agent, rep, driver, truck, route, batches and dates | Owner, accounting |
| Trip balance | Loaded, delivered, route sales, returned, damaged, missing | Stores, accounting |
| Sales | By rep, agent, customer, route and product | Owner, accounting |
| Vouchers | Issued, used, expired, by rep and customer | Accounting |
| Awaiting close and ageing | Completed deliveries not yet paid, by age | Accounting |
| Profit and loss | Per the cost treatments above | Owner, accounting |
| Audit log | Every change | Owner, accounting |

## Grandmeal's answers

| Question | Answer |
| --- | --- |
| Products | Mealie meal 5 kg, 10 kg, 20 kg and 50 kg |
| Packaging and profit | Cost of sales and expenses both come off to reach net profit; packaging sits in cost of sales |
| Fuel | Issued per machine: truck, mill, generator |
| Who plans trips | The manager |
| Who assigns orders and trips | The accountant |
| Vouchers | One per customer |
| Drivers | Log in; record fuel, odometer and time out and in; security approves each before the system updates |
| Route payments | Any method |
| Credit limit | No new sale until the earlier balance is cleared |
