-- Migration unit 1: schema_changes
-- Transaction mode: transactional
-- Boundary reason: default

SET check_function_bodies = false;

CREATE OR REPLACE FUNCTION public.contains_direct_identifier (
  value text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select coalesce(value, '') ~* (
    '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
    || '|(^|[^[:alnum:]])(\+?1[[:space:].-]?)?(\([0-9]{3}\)|[0-9]{3})[[:space:].-]?[0-9]{3}[[:space:].-]?[0-9]{4}([^[:alnum:]]|$)'
    || '|(^|[^0-9])[0-9]{3}-[0-9]{2}-[0-9]{4}([^0-9]|$)'
    || '|(student|participant|child|client|case)[[:space:]]*(id|identifier|number|no\.?)[[:space:]]*[:#-]?[[:space:]]*[[:alnum:]][[:alnum:]-]{3,}'
    || '|(date[[:space:]]+of[[:space:]]+birth|d\.?o\.?b\.?|born)[[:space:]]*[:#-]?[[:space:]]*([0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}[/\-][0-9]{1,2}[/\-][0-9]{2,4})'
    || '|(^|[^0-9])[0-9]{1,6}[[:space:]]+([[:alnum:].''-]+[[:space:]]+){0,5}(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|court|ct\.?|place|pl\.?|circle|terrace|trail)([^[:alpha:]]|$)'
    || '|\m((student|child|parent|mother|father|guardian|participant|client|family)[[:space:]]+)?name[[:space:]]*(is[[:space:]]+|:[[:space:]]*)[[:alpha:]][[:alpha:]''’-]{1,30}[[:space:]]+[[:alpha:]][[:alpha:]''’-]{1,30}'
  );
$function$;
